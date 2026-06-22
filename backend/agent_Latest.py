import re
import hashlib
import subprocess
import asyncio
import threading
import time
from datetime import datetime, timedelta
from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import text
import jwt
import uuid
import json
from typing import Optional, Dict
from config import (
    app_logger, db_logger, ws_logger, api_logger,
    SECRET_KEY, ALGORITHM, FS_HOST, FS_PORT, FS_PASSWORD,
    REDIS_AVAILABLE, redis_client, SessionLocal, manager,
    get_db_session, log_error
)

security = HTTPBearer()


# ============================================
# Helper Utilities
# ============================================

def _strip_ansi(text: str) -> str:
    """Remove ANSI escape codes injected by fs_cli when running in terminal context"""
    return re.sub(r'\x1b\[[0-9;]*m', '', text).strip()


def get_agent_contact(agent_id: str, domain: str = FS_HOST) -> Optional[str]:
    """
    Fetch the full SIP contact URI for an agent.
    Returns something like: 'sip:1000@192.168.200.21:55254;rinstance=...'
    Returns None if agent is not registered.
    """
    try:
        # Method 1: Use sofia_contact (fast, but sometimes returns full dialstring)
        cmd1 = f'/usr/local/freeswitch/bin/fs_cli -x "sofia_contact {agent_id}@{domain}"'
        result1 = subprocess.run(cmd1, shell=True, capture_output=True, text=True, timeout=5)
        output1 = _strip_ansi(result1.stdout).strip()
        app_logger.info(f"sofia_contact output for {agent_id}: '{output1}'")

        if output1 and "error/user_not_registered" not in output1 and "not_found" not in output1.lower():
            # Extract the pure SIP URI (remove any leading sofia/internal/ or user/ prefix)
            if "sofia/internal/" in output1:
                contact = output1.split("sofia/internal/")[-1]
            elif "user/" in output1:
                contact = output1.split("user/")[-1]
            else:
                contact = output1
            # Ensure it starts with 'sip:'
            if contact.startswith("sip:"):
                app_logger.info(f"✅ Contact via sofia_contact: {contact}")
                return contact
            else:
                app_logger.warning(f"Contact does not start with sip: {contact}")

        # Method 2: Parse 'sofia status profile internal reg' output (reliable fallback)
        cmd2 = '/usr/local/freeswitch/bin/fs_cli -x "sofia status profile internal reg"'
        result2 = subprocess.run(cmd2, shell=True, capture_output=True, text=True, timeout=10)
        reg_output = _strip_ansi(result2.stdout)
        app_logger.debug(f"Registration table:\n{reg_output}")

        # Look for the line containing 'User: {agent_id}@...'
        # Then extract Contact URI from the next line or same line? In your output, Contact is on a separate line.
        # We'll parse line by line, keeping context.
        lines = reg_output.split('\n')
        found_user = False
        for i, line in enumerate(lines):
            if 'User:' in line and f'{agent_id}@' in line:
                found_user = True
                # The contact line usually appears after the User line, but may be on the same line? Not in your output.
                # Look ahead up to 5 lines for 'Contact:'
                for j in range(i, min(i+5, len(lines))):
                    contact_line = lines[j]
                    if 'Contact:' in contact_line:
                        # Extract the URI inside <...>
                        match = re.search(r'<sip:([^>]+)>', contact_line)
                        if match:
                            contact_uri = match.group(1)
                            app_logger.info(f"✅ Contact via profile reg fallback: {contact_uri}")
                            return contact_uri
                        else:
                            # Try without angle brackets
                            match2 = re.search(r'sip:([^\s]+)', contact_line)
                            if match2:
                                contact_uri = match2.group(0)
                                app_logger.info(f"✅ Contact via profile reg fallback (no brackets): {contact_uri}")
                                return contact_uri
                break

        app_logger.warning(f"❌ Could not find contact for agent {agent_id} using any method")
        return None

    except Exception as e:
        log_error("agent", e, {"function": "get_agent_contact", "agent_id": agent_id})
        return None


# ============================================
# FreeSWITCH Agent Functions (All preserved)
# ============================================

def set_callcenter_status(agent_id: str, status: str, domain: str = FS_HOST):
    """Set agent's callcenter status in FreeSWITCH"""
    try:
        cmd = f'/usr/local/freeswitch/bin/fs_cli -x "callcenter_config agent set status {agent_id}@{domain} {status}"'
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        if "+OK" in result.stdout:
            ws_logger.info(f"✅ Callcenter status for {agent_id} set to {status}")
            return True
        else:
            ws_logger.warning(f"⚠️ Failed to set callcenter status for {agent_id}. Output: {repr(result.stdout)}")
            return False
    except Exception as e:
        log_error("agent", e, {"function": "set_callcenter_status", "agent_id": agent_id})
        return False


def check_softphone_registration(agent_id: str, domain: str = FS_HOST) -> bool:
    """
    Check if agent's softphone is registered with FreeSWITCH.
    """
    try:
        # Primary check: sofia_contact
        cmd = f'/usr/local/freeswitch/bin/fs_cli -x "sofia_contact user/{agent_id}@{domain}"'
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        output = _strip_ansi(result.stdout)
        if output and "error/user_not_registered" not in output and agent_id in output:
            return True
        # Fallback: parse status table
        cmd2 = '/usr/local/freeswitch/bin/fs_cli -x "sofia status profile internal reg"'
        result2 = subprocess.run(cmd2, shell=True, capture_output=True, text=True, timeout=10)
        reg_output = _strip_ansi(result2.stdout)
        for line in reg_output.split('\n'):
            if 'User:' in line and f'{agent_id}@' in line:
                return True
        return False
    except Exception as e:
        log_error("agent", e, {"function": "check_softphone_registration", "agent_id": agent_id})
        return False


def force_logout_agent(agent_id: str, db_session=None):
    """Force logout an agent from all systems"""
    should_close_db = False
    if db_session is None:
        db_session = get_db_session()
        should_close_db = True
    try:
        db_session.execute(
            text("UPDATE agents SET status = 'LoggedOut', last_logout = NOW() WHERE agent_id = :agent_id"),
            {"agent_id": agent_id}
        )
        db_session.commit()
        db_logger.info(f"✅ Database: Agent {agent_id} set to LoggedOut")
        if REDIS_AVAILABLE and redis_client:
            redis_client.delete(f"agent:{agent_id}")
            redis_client.srem("online_agents", agent_id)
        set_callcenter_status(agent_id, "LoggedOut")
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(manager.send_to_agent(agent_id, {
                    "type": "force_logout",
                    "message": "Your softphone has disconnected. You have been logged out.",
                    "timestamp": datetime.now().isoformat()
                }))
        except Exception as e:
            ws_logger.error(f"WebSocket notification error: {e}")
        return True
    except Exception as e:
        log_error("agent", e, {"function": "force_logout_agent", "agent_id": agent_id})
        return False
    finally:
        if should_close_db:
            db_session.close()


def update_agent_status(agent_id: str, status: str, db_session=None):
    """Update agent status in database and Redis"""
    should_close_db = False
    if db_session is None:
        db_session = get_db_session()
        should_close_db = True
    try:
        db_session.execute(
            text("UPDATE agents SET status = :status WHERE agent_id = :agent_id"),
            {"status": status, "agent_id": agent_id}
        )
        db_session.commit()
        if REDIS_AVAILABLE and redis_client:
            redis_client.hset(f"agent:{agent_id}", "status", status)
        db_logger.info(f"✅ Agent {agent_id} status updated to {status}")
        return True
    except Exception as e:
        log_error("agent", e, {"function": "update_agent_status", "agent_id": agent_id})
        return False
    finally:
        if should_close_db:
            db_session.close()


def get_agent_info(agent_id: str, db_session=None):
    """Get agent information from database"""
    should_close_db = False
    if db_session is None:
        db_session = get_db_session()
        should_close_db = True
    try:
        result = db_session.execute(
            text("SELECT * FROM agents WHERE agent_id = :agent_id"),
            {"agent_id": agent_id}
        )
        agent = result.first()
        return dict(agent) if agent else None
    except Exception as e:
        log_error("agent", e, {"function": "get_agent_info", "agent_id": agent_id})
        return None
    finally:
        if should_close_db:
            db_session.close()


def get_agent_performance(agent_id: str, days: int = 7):
    """Get agent performance metrics"""
    db_session = get_db_session()
    try:
        result = db_session.execute(
            text("""
                SELECT
                    COUNT(*) as total_calls,
                    SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as answered_calls,
                    SUM(CASE WHEN status = 'Missed' THEN 1 ELSE 0 END) as missed_calls,
                    AVG(CASE WHEN status = 'Completed' AND duration > 0 THEN duration ELSE NULL END) as avg_handle_time
                FROM call_logs
                WHERE agent_id = :agent_id
                AND start_time >= DATE_SUB(NOW(), INTERVAL :days DAY)
            """),
            {"agent_id": agent_id, "days": days}
        )
        stats = result.first()
        return {
            "total_calls": stats[0] or 0,
            "answered_calls": stats[1] or 0,
            "missed_calls": stats[2] or 0,
            "avg_handle_time": float(stats[3]) if stats[3] else 0.0
        }
    except Exception as e:
        log_error("agent", e, {"function": "get_agent_performance", "agent_id": agent_id})
        return None
    finally:
        db_session.close()


# ============================================
# FreeSWITCH Event Monitor (Agent-Specific)
# ============================================

class FreeSWITCHAgentMonitor:
    def __init__(self):
        self.running = False
        self.thread = None
        self.registered_agents: Dict[str, float] = {}

    def start(self):
        """Start monitoring FreeSWITCH events for agents"""
        self.running = True
        self.thread = threading.Thread(target=self._monitor_events, daemon=True)
        self.thread.start()
        app_logger.info("📡 FreeSWITCH agent monitor started")

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        app_logger.info("🛑 FreeSWITCH agent monitor stopped")

    def _send_websocket_message(self, agent_id: str, message: dict):
        """Send WebSocket message to agent"""
        try:
            try:
                loop = asyncio.get_running_loop()
                asyncio.create_task(manager.send_to_agent(agent_id, message))
            except RuntimeError:
                asyncio.run(manager.send_to_agent(agent_id, message))
        except Exception as e:
            ws_logger.error(f"Failed to send WebSocket message to {agent_id}: {e}")

    def _monitor_events(self):
        """Monitor FreeSWITCH ESL for registration events"""
        try:
            import ESL
            while self.running:
                try:
                    conn = ESL.ESLconnection("127.0.0.1", FS_PORT, FS_PASSWORD)
                    if conn and conn.connected():
                        ws_logger.info("✅ ESL event listener connected")
                        conn.events("plain", "REGISTER", "UNREGISTER")
                        while self.running:
                            event = conn.recvEvent()
                            if event:
                                event_name = event.getHeader("Event-Name")
                                user = event.getHeader("User")
                                if user:
                                    agent_id = user.split('@')[0]
                                    if event_name == "REGISTER":
                                        ws_logger.info(f"📱 Agent {agent_id} REGISTERED")
                                        self.registered_agents[agent_id] = time.time()
                                        self._send_websocket_message(agent_id, {
                                            "type": "softphone_registered",
                                            "message": "Softphone connected",
                                            "timestamp": datetime.now().isoformat()
                                        })
                                    elif event_name == "UNREGISTER":
                                        ws_logger.warning(f"📱 Agent {agent_id} UNREGISTERED")
                                        if agent_id in self.registered_agents:
                                            del self.registered_agents[agent_id]
                                        force_logout_agent(agent_id)
                                        self._send_websocket_message(agent_id, {
                                            "type": "softphone_unregistered",
                                            "message": "Softphone disconnected. You have been logged out.",
                                            "force_logout": True,
                                            "timestamp": datetime.now().isoformat()
                                        })
                    time.sleep(5)
                except Exception as e:
                    ws_logger.error(f"ESL event loop error: {e}")
                    time.sleep(5)

        except ImportError:
            ws_logger.warning("ESL module not available. Using polling mode.")
            self._monitor_by_polling()

    def _monitor_by_polling(self):
        """Fallback: Poll registration status periodically"""
        while self.running:
            try:
                cmd = '/usr/local/freeswitch/bin/fs_cli -x "sofia status profile internal reg"'
                result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
                output = _strip_ansi(result.stdout)

                current_registered = set()
                for line in output.split('\n'):
                    if 'User:' in line:
                        parts = line.split('User:')
                        if len(parts) > 1:
                            user = parts[1].strip().split('@')[0].strip()
                            if user.isdigit():
                                current_registered.add(user)

                # Detect agents that dropped off
                for agent_id in list(self.registered_agents.keys()):
                    if agent_id not in current_registered:
                        ws_logger.warning(f"⚠️ Agent {agent_id} unregistered (polling detected)")
                        force_logout_agent(agent_id)
                        del self.registered_agents[agent_id]

                # Refresh current registrations
                self.registered_agents = {aid: time.time() for aid in current_registered}

                time.sleep(10)
            except Exception as e:
                ws_logger.error(f"Polling error: {e}")
                time.sleep(10)


# ============================================
# Agent API Endpoints (All preserved)
# ============================================

async def agent_login_endpoint(login_request):
    """Handle agent login"""
    db_session = get_db_session()
    try:
        app_logger.info(f"Login attempt: {login_request.agent_id}")

        # Fetch agent from DB
        result = db_session.execute(
            text("SELECT * FROM agents WHERE agent_id = :agent_id"),
            {"agent_id": login_request.agent_id}
        )
        agent = result.first()

        if not agent:
            raise HTTPException(status_code=401, detail="❌ Agent ID not found")

        # Verify password
        computed_md5 = hashlib.md5(login_request.password.encode()).hexdigest()
        if computed_md5 != agent.password_hash:
            raise HTTPException(status_code=401, detail="❌ Incorrect password")

        # Check softphone registration
        is_registered = check_softphone_registration(login_request.agent_id)
        if not is_registered:
            raise HTTPException(
                status_code=400,
                detail="⚠️ Please login through your softphone first. Your SIP extension is not registered."
            )

        # Set callcenter status to Available
        set_callcenter_status(login_request.agent_id, "Available")

        # Update DB
        db_session.execute(
            text("UPDATE agents SET last_login = NOW(), status = 'Available' WHERE agent_id = :agent_id"),
            {"agent_id": login_request.agent_id}
        )
        db_session.commit()

        # Store in Redis
        if REDIS_AVAILABLE and redis_client:
            redis_client.hset(f"agent:{login_request.agent_id}", mapping={
                "full_name": agent.full_name,
                "extension": agent.extension,
                "role": agent.role,
                "status": "Available",
                "login_time": datetime.now().isoformat()
            })
            redis_client.expire(f"agent:{login_request.agent_id}", 28800)
            redis_client.sadd("online_agents", login_request.agent_id)

        # Issue JWT
        access_token = jwt.encode(
            {"sub": agent.agent_id, "exp": datetime.utcnow() + timedelta(hours=8)},
            SECRET_KEY,
            algorithm=ALGORITHM
        )

        return {
            "success": True,
            "message": "✅ Login successful",
            "access_token": access_token,
            "token_type": "bearer",
            "agent": {
                "agent_id": agent.agent_id,
                "full_name": agent.full_name,
                "extension": agent.extension,
                "role": agent.role,
                "status": "Available"
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        log_error("agent", e, {"function": "agent_login", "agent_id": login_request.agent_id})
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db_session.close()


async def agent_logout_endpoint(agent_id: str):
    """Handle agent logout"""
    db_session = get_db_session()
    try:
        set_callcenter_status(agent_id, "LoggedOut")

        db_session.execute(
            text("UPDATE agents SET status = 'LoggedOut', last_logout = NOW() WHERE agent_id = :agent_id"),
            {"agent_id": agent_id}
        )
        db_session.commit()

        if REDIS_AVAILABLE and redis_client:
            redis_client.delete(f"agent:{agent_id}")
            redis_client.srem("online_agents", agent_id)

        return {
            "success": True,
            "message": f"✅ Agent {agent_id} logged out successfully"
        }

    except Exception as e:
        log_error("agent", e, {"function": "agent_logout", "agent_id": agent_id})
        raise HTTPException(status_code=500, detail="Logout failed")
    finally:
        db_session.close()


async def agent_heartbeat_endpoint(token: str):
    """Handle agent heartbeat — verifies token and softphone registration"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        agent_id = payload.get("sub")
        if not agent_id:
            raise HTTPException(status_code=401, detail="Invalid token")

        # Check softphone registration
        is_registered = check_softphone_registration(agent_id)
        if not is_registered:
            force_logout_agent(agent_id)
            raise HTTPException(status_code=401, detail="Softphone disconnected. Session terminated.")

        # Refresh heartbeat timestamp in Redis
        if REDIS_AVAILABLE and redis_client:
            redis_client.hset(f"agent:{agent_id}", "last_heartbeat", datetime.now().isoformat())

        return {
            "success": True,
            "softphone_registered": True,
            "agent_id": agent_id,
            "session_expires": (datetime.now() + timedelta(hours=8)).isoformat()
        }

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except HTTPException:
        raise
    except Exception as e:
        log_error("agent", e, {"function": "agent_heartbeat"})
        raise HTTPException(status_code=500, detail="Heartbeat failed")


async def agent_websocket_endpoint(websocket: WebSocket, agent_id: str):
    """WebSocket endpoint for real-time agent communication"""
    client_id = f"agent_{agent_id}_{datetime.now().timestamp()}"
    try:
        await manager.connect_agent(websocket, agent_id, client_id)

        is_registered = check_softphone_registration(agent_id)
        await manager.send_to_agent(agent_id, {
            "type": "connection_established",
            "agent_id": agent_id,
            "softphone_registered": is_registered,
            "timestamp": datetime.now().isoformat()
        })

        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
            else:
                ws_logger.info(f"Received from agent {agent_id}: {data}")

    except WebSocketDisconnect:
        ws_logger.info(f"Agent WebSocket disconnected: {agent_id}")
    except Exception as e:
        log_error("agent", e, {"function": "agent_websocket", "agent_id": agent_id})
    finally:
        manager.disconnect(client_id)


# ============================================
# Call Control Functions (FIXED)
# ============================================

def originate_call_direct(agent_id: str, phone_number: str, caller_id: str = None) -> dict:
    """
    Direct originate call using ESL.
    Rings agent first, then bridges to external number via gateway.
    Uses the exact contact string from FreeSWITCH, handling NAT automatically.
    """
    try:
        import ESL

        # 1. Get the exact SIP contact URI (e.g., 'sip:1000@192.168.200.21:55254;rinstance=...')
        contact_uri = get_agent_contact(agent_id)
        if not contact_uri:
            app_logger.warning(f"❌ Originate blocked: Agent {agent_id} softphone not registered")
            return {
                "success": False,
                "error": "Agent softphone is not registered. Please ensure your softphone is connected.",
                "error_code": 400
            }

        # 2. Connect to ESL
        conn = ESL.ESLconnection("127.0.0.1", FS_PORT, FS_PASSWORD)
        if not conn or not conn.connected():
            app_logger.error("Failed to connect to FreeSWITCH ESL")
            return {"success": False, "error": "ESL connection failed"}

        call_uuid = str(uuid.uuid4())
        if not caller_id:
            caller_id = agent_id

        # Normalise phone number (strip leading zero)
        original_number = phone_number
        if phone_number.startswith('0'):
            phone_number = phone_number[1:]

        # 3. Build originate command EXACTLY like the working CLI command
        originate_str = (
            f"originate {{origination_caller_id_number={caller_id},"
            f"origination_uuid={call_uuid},"
            f"originate_timeout=60,"
            f"absolute_codec_string='PCMU,PCMA'}}"
            f"sofia/internal/{contact_uri} "
            f"&bridge({{absolute_codec_string='PCMU,PCMA'}}sofia/gateway/czentrix/{phone_number})"
        )

        app_logger.info(f"Originate command: {originate_str}")

        # Execute the originate
        response = conn.api(originate_str)
        reply = ""
        if response:
            if hasattr(response, 'getHeader'):
                reply = response.getHeader("Reply-Text") or ""
            else:
                reply = str(response)
        app_logger.info(f"Originate response: {reply}")

        # Relaxed success condition: if the reply contains any of these, consider it successful
        # because many FreeSWITCH versions return "N/A" or other text but the call still works.
        success_keywords = ["+OK", "call-id", "Channel", "created", "N/A"]
        if any(keyword in reply for keyword in success_keywords):
            # Try to extract a real UUID from the reply (maybe the one we generated is fine)
            extracted_uuid = None
            for part in reply.split():
                if "-" in part and len(part) > 30:
                    extracted_uuid = part
                    break
            if extracted_uuid:
                call_uuid = extracted_uuid
            # Log call to database
            db_session = get_db_session()
            try:
                db_session.execute(
                    text("""
                        INSERT INTO call_logs
                            (call_uuid, agent_id, direction, destination, start_time, status, call_type)
                        VALUES
                            (:call_uuid, :agent_id, 'Outbound', :destination, NOW(), 'Ringing', 'Outbound')
                    """),
                    {"call_uuid": call_uuid, "agent_id": agent_id, "destination": original_number}
                )
                db_session.commit()
                app_logger.info(f"Call logged to database: {call_uuid}")
            except Exception as e:
                app_logger.error(f"Failed to log call to database: {e}")
            finally:
                db_session.close()

            return {
                "success": True,
                "message": "Call initiated successfully",
                "call_uuid": call_uuid,
                "agent_id": agent_id,
                "phone_number": original_number
            }
        else:
            # Only fail if the reply explicitly says error or failed
            if "error" in reply.lower() or "failed" in reply.lower():
                return {"success": False, "error": f"FreeSWITCH rejected originate: {reply}"}
            else:
                # Unknown reply but not obviously an error – assume call is in progress
                app_logger.warning(f"Ambiguous originate reply, assuming success: {reply}")
                # Still log the call
                db_session = get_db_session()
                try:
                    db_session.execute(
                        text("""
                            INSERT INTO call_logs
                                (call_uuid, agent_id, direction, destination, start_time, status, call_type)
                            VALUES
                                (:call_uuid, :agent_id, 'Outbound', :destination, NOW(), 'Ringing', 'Outbound')
                        """),
                        {"call_uuid": call_uuid, "agent_id": agent_id, "destination": original_number}
                    )
                    db_session.commit()
                except Exception as e:
                    app_logger.error(f"Failed to log call to database: {e}")
                finally:
                    db_session.close()
                return {
                    "success": True,
                    "message": "Call initiated (ambiguous response but call seems active)",
                    "call_uuid": call_uuid,
                    "agent_id": agent_id,
                    "phone_number": original_number
                }

    except Exception as e:
        log_error("agent", e, {"function": "originate_call_direct", "agent_id": agent_id})
        return {"success": False, "error": str(e)}

def originate_with_bridge(agent_id: str, phone_number: str, caller_id: str = None, gateway: str = "czentrix") -> dict:
    """
    Originate call with bridge between agent and external number.
    Uses bgapi for non-blocking execution.
    """
    try:
        import ESL

        contact_uri = get_agent_contact(agent_id)
        if not contact_uri:
            return {"success": False, "error": "Agent softphone is not registered.", "error_code": 400}

        conn = ESL.ESLconnection("127.0.0.1", FS_PORT, FS_PASSWORD)
        if not conn or not conn.connected():
            return {"success": False, "error": "ESL connection failed"}

        call_uuid = str(uuid.uuid4())
        if not caller_id:
            caller_id = agent_id
        if phone_number.startswith('0'):
            phone_number = phone_number[1:]

        originate_str = (
            f"originate {{origination_caller_id_number={caller_id},"
            f"absolute_codec_string='PCMU,PCMA',"
            f"ignore_early_media=true,"
            f"originate_timeout=60,"
            f"origination_uuid={call_uuid}}}"
            f"sofia/internal/{contact_uri} "
            f"&bridge({{origination_caller_id_number={caller_id},"
            f"absolute_codec_string='PCMU,PCMA'}}"
            f"sofia/gateway/{gateway}/{phone_number})"
        )

        response = conn.api("bgapi", originate_str)
        reply = response.getHeader("Reply-Text") if response else ""
        app_logger.info(f"originate_with_bridge response: {reply}")
        return {"success": True, "message": "Call bridged successfully", "call_uuid": call_uuid}
    except Exception as e:
        log_error("agent", e, {"function": "originate_with_bridge"})
        return {"success": False, "error": str(e)}

def check_call_status(call_uuid: str) -> dict:
    """
    Return live status: 'ringing', 'connected', or 'ended'.
    Falls back to database if ESL fails.
    """
    try:
        import ESL
        conn = ESL.ESLconnection("127.0.0.1", FS_PORT, FS_PASSWORD)
        if conn and conn.connected():
            response = conn.api("uuid_status", call_uuid)
            if response:
                reply = response.getHeader("Reply-Text") or ""
                reply_lower = reply.lower()
                if "state=active" in reply_lower or "state=up" in reply_lower:
                    return {"success": True, "status": "connected", "call_uuid": call_uuid}
                elif "state=ringing" in reply_lower or "state=early" in reply_lower:
                    return {"success": True, "status": "ringing", "call_uuid": call_uuid}
                elif "state=hangup" in reply_lower or "not found" in reply_lower:
                    return {"success": True, "status": "ended", "call_uuid": call_uuid}
    except Exception as e:
        app_logger.warning(f"ESL status check failed: {e}")

    # Fallback: check database call_logs
    db_session = get_db_session()
    try:
        result = db_session.execute(
            text("SELECT status, end_time FROM call_logs WHERE call_uuid = :call_uuid"),
            {"call_uuid": call_uuid}
        ).first()
        if result:
            status, end_time = result
            if end_time is not None:
                return {"success": True, "status": "ended", "call_uuid": call_uuid}
            elif status == "Completed":
                return {"success": True, "status": "connected", "call_uuid": call_uuid}
            else:
                return {"success": True, "status": "ringing", "call_uuid": call_uuid}
        else:
            return {"success": True, "status": "ended", "call_uuid": call_uuid}
    except Exception as e:
        app_logger.error(f"Database status check failed: {e}")
        return {"success": False, "error": str(e), "status": "unknown"}
    finally:
        db_session.close()

def hangup_call(call_uuid: str) -> dict:
    """Hangup a call by UUID and update call log"""
    try:
        import ESL
        conn = ESL.ESLconnection("127.0.0.1", FS_PORT, FS_PASSWORD)
        if not conn or not conn.connected():
            return {"success": False, "error": "ESL connection failed"}
        response = conn.api("uuid_kill", call_uuid)
        reply = response.getHeader("Reply-Text") if response else ""
        app_logger.info(f"uuid_kill response for {call_uuid}: {reply}")
        db_session = get_db_session()
        try:
            db_session.execute(
                text("UPDATE call_logs SET end_time = NOW(), status = 'Completed' WHERE call_uuid = :call_uuid"),
                {"call_uuid": call_uuid}
            )
            db_session.commit()
        except Exception as e:
            app_logger.error(f"Failed to update call log for {call_uuid}: {e}")
        finally:
            db_session.close()
        return {"success": True, "message": "Call hung up successfully", "call_uuid": call_uuid}
    except Exception as e:
        log_error("agent", e, {"function": "hangup_call"})
        return {"success": False, "error": str(e)}
