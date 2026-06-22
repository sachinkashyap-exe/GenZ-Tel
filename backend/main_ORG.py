from fastapi import FastAPI, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from contextlib import asynccontextmanager
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import hashlib
from datetime import datetime, timedelta
import jwt
import uvicorn
import logging
import os
from pathlib import Path
import subprocess
import asyncio
import threading
from typing import Dict
import time

# ============================================
# Configuration & Environment Variables
# ============================================
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-12345")
ALGORITHM = "HS256"
DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://root:hradmin@localhost/fs_manager")
FS_HOST = os.getenv("FS_HOST", "192.168.1.248")
FS_PORT = int(os.getenv("FS_PORT", "8021"))
FS_PASSWORD = os.getenv("FS_PASSWORD", "ClueCon")
ENVIRONMENT = os.getenv("ENVIRONMENT", "production")

# Create log directories
LOG_DIR = "/tmp/fs_logs"
Path(LOG_DIR).mkdir(parents=True, exist_ok=True)

# Setup loggers
logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(message)s')

api_logger = logging.getLogger('api')
api_handler = logging.FileHandler(f"{LOG_DIR}/api.log")
api_logger.addHandler(api_handler)

db_logger = logging.getLogger('db')
db_handler = logging.FileHandler(f"{LOG_DIR}/db.log")
db_logger.addHandler(db_handler)

app_logger = logging.getLogger('app')
app_handler = logging.FileHandler(f"{LOG_DIR}/app.log")
app_logger.addHandler(app_handler)

ws_logger = logging.getLogger('websocket')
ws_handler = logging.FileHandler(f"{LOG_DIR}/websocket.log")
ws_logger.addHandler(ws_handler)

# ============================================
# Lifespan context manager
# ============================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    app_logger.info("🚀 Server starting up...")
    yield
    # Shutdown
    app_logger.info("🛑 Server shutting down...")
    if hasattr(app, 'fs_monitor'):
        app.fs_monitor.stop()
        app_logger.info("✅ FreeSWITCH monitor stopped")

app = FastAPI(lifespan=lifespan)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://172.16.1.93:3000",
        "http://192.168.1.248:3000",
        "http://192.168.1.248",
        "ws://localhost:3000",
        "ws://127.0.0.1:3000",
        "ws://172.16.1.93:3000",
        "ws://192.168.1.248:3000",
        "ws://192.168.1.248",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Custom exception handler for better error messages
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.detail,
            "error_code": exc.status_code,
            "timestamp": datetime.now().isoformat(),
        }
    )

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = datetime.now()
    response = await call_next(request)
    duration = (datetime.now() - start).total_seconds()
    api_logger.info(f"{request.method} {request.url.path} -> {response.status_code} ({duration:.3f}s)")
    return response

# Database connection
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

security = HTTPBearer()

# Redis connection
REDIS_AVAILABLE = False
redis_client = None

try:
    import redis
    redis_client = redis.Redis(
        host='localhost',
        port=6379,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2
    )
    redis_client.ping()
    REDIS_AVAILABLE = True
    app_logger.info("✅ Redis connected")
except Exception as e:
    app_logger.warning(f"⚠️ Redis not available: {e}")

# ============================================
# WebSocket Connection Manager (Cleaned)
# ============================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.agent_sessions: Dict[str, str] = {}

    async def connect(self, websocket: WebSocket, agent_id: str, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        self.agent_sessions[agent_id] = client_id
        ws_logger.info(f"✅ WebSocket connected for agent {agent_id} (client: {client_id})")

    def disconnect(self, client_id: str):
        # Find and remove agent
        agent_id = None
        for aid, cid in self.agent_sessions.items():
            if cid == client_id:
                agent_id = aid
                break

        if agent_id:
            del self.agent_sessions[agent_id]

        if client_id in self.active_connections:
            del self.active_connections[client_id]

        ws_logger.info(f"❌ WebSocket disconnected for client {client_id}")

    async def send_personal_message(self, message: dict, agent_id: str):
        if agent_id in self.agent_sessions:
            client_id = self.agent_sessions[agent_id]
            if client_id in self.active_connections:
                try:
                    await self.active_connections[client_id].send_json(message)
                    return True
                except Exception as e:
                    ws_logger.error(f"Error sending message: {e}")
                    self.disconnect(client_id)
        return False

manager = ConnectionManager()

# ============================================
# FreeSWITCH Helper Functions
# ============================================
def set_callcenter_status(agent_id, status, domain=FS_HOST):
    """
    Set agent's callcenter status in FreeSWITCH
    status: 'Available' or 'LoggedOut'
    """
    try:
        cmd = f'/usr/local/freeswitch/bin/fs_cli -x "callcenter_config agent set status {agent_id}@{domain} {status}"'
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)

        if "+OK" in result.stdout:
            ws_logger.info(f"✅ Callcenter status for {agent_id} set to {status}")
            return True
        else:
            ws_logger.warning(f"⚠️ Failed to set callcenter status for {agent_id}: {result.stdout}")
            return False
    except Exception as e:
        ws_logger.error(f"Error setting callcenter status: {e}")
        return False

def check_softphone_registration(agent_id, domain=FS_HOST):
    """
    Check if agent's softphone is registered with FreeSWITCH
    Returns True if registered, False otherwise
    """
    try:
        cmd = f'/usr/local/freeswitch/bin/fs_cli -x "sofia_contact user/{agent_id}@{domain}"'

        app_logger.info(f"Executing: {cmd}")

        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        output = result.stdout.strip()

        app_logger.info(f"Command output: '{output}'")

        if output and "sofia/internal/sip:" in output:
            app_logger.info(f"✅ Agent {agent_id} softphone is registered")
            return True
        else:
            app_logger.warning(f"❌ Agent {agent_id} softphone NOT registered. Output: {output}")
            return False

    except subprocess.TimeoutExpired:
        app_logger.error(f"Timeout checking registration for {agent_id}")
        return False
    except Exception as e:
        app_logger.error(f"Error checking registration for {agent_id}: {e}")
        return False

def logout_agent(agent_id: str, db_session=None):
    """Force logout an agent - Updates DB, Redis, and FreeSWITCH callcenter"""
    should_close_db = False
    if db_session is None:
        db_session = SessionLocal()
        should_close_db = True

    try:
        # 1. Update database status to LoggedOut
        db_session.execute(
            text("UPDATE agents SET status = 'LoggedOut', last_logout = NOW() WHERE agent_id = :agent_id"),
            {"agent_id": agent_id}
        )
        db_session.commit()
        app_logger.info(f"✅ Database: Agent {agent_id} set to LoggedOut")

        # 2. Remove from Redis (inline operation)
        if REDIS_AVAILABLE:
            try:
                redis_client.delete(f"agent:{agent_id}")
                redis_client.srem("online_agents", agent_id)
                app_logger.info(f"✅ Redis: Agent {agent_id} removed")
            except Exception as e:
                app_logger.error(f"❌ Redis remove error: {e}")

        # 3. Set callcenter status to LoggedOut in FreeSWITCH
        set_callcenter_status(agent_id, "LoggedOut")
        app_logger.info(f"✅ FreeSWITCH: Agent {agent_id} callcenter status set to LoggedOut")

        # 4. Notify via WebSocket (using thread-safe event loop handling)
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(manager.send_personal_message({
                    "type": "force_logout",
                    "message": "Your softphone has disconnected. You have been logged out.",
                    "timestamp": datetime.now().isoformat()
                }, agent_id))
            else:
                asyncio.run(manager.send_personal_message({
                    "type": "force_logout",
                    "message": "Your softphone has disconnected. You have been logged out.",
                    "timestamp": datetime.now().isoformat()
                }, agent_id))
        except RuntimeError:
            # No event loop running, create a new one
            asyncio.run(manager.send_personal_message({
                "type": "force_logout",
                "message": "Your softphone has disconnected. You have been logged out.",
                "timestamp": datetime.now().isoformat()
            }, agent_id))

        app_logger.info(f"✅ Force logout completed for agent {agent_id}")

    except Exception as e:
        app_logger.error(f"Error force logging out {agent_id}: {e}")
    finally:
        if should_close_db:
            db_session.close()

# ============================================
# FreeSWITCH Event Monitor Thread (Fixed async issue)
# ============================================
class FreeSWITCHMonitor:
    def __init__(self):
        self.running = False
        self.thread = None
        self.registered_agents = {}
        self.loop = None

    def start(self):
        """Start monitoring FreeSWITCH events"""
        self.running = True
        self.thread = threading.Thread(target=self._monitor_events, daemon=True)
        self.thread.start()
        app_logger.info("📡 FreeSWITCH event monitor started")

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        app_logger.info("🛑 FreeSWITCH event monitor stopped")

    def _send_websocket_message(self, agent_id: str, message: dict):
        """Helper method to send WebSocket messages from thread"""
        try:
            # Try to get the running event loop and schedule the coroutine
            try:
                loop = asyncio.get_running_loop()
                asyncio.create_task(manager.send_personal_message(message, agent_id))
            except RuntimeError:
                # No running loop, create a new one
                asyncio.run(manager.send_personal_message(message, agent_id))
        except Exception as e:
            ws_logger.error(f"Failed to send WebSocket message: {e}")

    def _monitor_events(self):
        """Monitor FreeSWITCH ESL for registration events"""
        try:
            import ESL

            while self.running:
                try:
                    conn = ESL.ESLconnection("127.0.0.1", FS_PORT, FS_PASSWORD)
                    if conn and conn.connected():
                        ws_logger.info("✅ ESL event listener connected")

                        # Subscribe to registration events
                        conn.events("plain", "REGISTER", "UNREGISTER")

                        while self.running:
                            event = conn.recvEvent()
                            if event:
                                event_name = event.getHeader("Event-Name")
                                user = event.getHeader("User")

                                if user:
                                    # Extract agent ID (remove domain if present)
                                    agent_id = user.split('@')[0]

                                    if event_name == "REGISTER":
                                        ws_logger.info(f"📱 REAL-TIME: Agent {agent_id} REGISTERED")
                                        self.registered_agents[agent_id] = time.time()

                                        # Notify via WebSocket
                                        self._send_websocket_message(agent_id, {
                                            "type": "softphone_registered",
                                            "agent_id": agent_id,
                                            "message": "Softphone connected",
                                            "timestamp": datetime.now().isoformat()
                                        })

                                    elif event_name == "UNREGISTER":
                                        ws_logger.warning(f"📱 REAL-TIME: Agent {agent_id} UNREGISTERED")

                                        if agent_id in self.registered_agents:
                                            del self.registered_agents[agent_id]

                                        # Force logout immediately
                                        ws_logger.warning(f"⚠️ Force logging out {agent_id} due to unregister")
                                        logout_agent(agent_id)

                                        # Notify via WebSocket
                                        self._send_websocket_message(agent_id, {
                                            "type": "softphone_unregistered",
                                            "agent_id": agent_id,
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
                output = result.stdout

                # Parse registered extensions
                current_registered = set()
                for line in output.split('\n'):
                    if 'sip:' in line and 'User:' in line:
                        parts = line.split('User:')
                        if len(parts) > 1:
                            user = parts[1].strip().split('@')[0]
                            if user.isdigit():
                                current_registered.add(user)

                # Check for unregistered agents
                for agent_id in list(self.registered_agents.keys()):
                    if agent_id not in current_registered:
                        ws_logger.warning(f"⚠️ Agent {agent_id} unregistered (polling detected)")
                        logout_agent(agent_id)
                        del self.registered_agents[agent_id]

                # Update current registrations
                self.registered_agents = {aid: time.time() for aid in current_registered}
                time.sleep(10)

            except Exception as e:
                ws_logger.error(f"Polling error: {e}")
                time.sleep(10)

# Start FreeSWITCH monitor
fs_monitor = FreeSWITCHMonitor()
fs_monitor.start()
app.fs_monitor = fs_monitor

# ============================================
# Pydantic Models
# ============================================
class LoginRequest(BaseModel):
    agent_id: str
    password: str

class LogoutRequest(BaseModel):
    agent_id: str

class HeartbeatRequest(BaseModel):
    agent_id: str

# ============================================
# Helper Functions
# ============================================
def verify_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except:
        return None

# ============================================
# API Endpoints
# ============================================
@app.post("/api/auth/login")
async def agent_login(login: LoginRequest):
    db = SessionLocal()
    try:
        app_logger.info(f"Login attempt: {login.agent_id}")

        # Check Database first
        try:
            result = db.execute(
                text("SELECT * FROM agents WHERE agent_id = :agent_id"),
                {"agent_id": login.agent_id}
            )
            agent = result.first()
        except Exception as db_error:
            app_logger.error(f"Database connection error: {db_error}")
            raise HTTPException(
                status_code=503,
                detail="Database connection failed. Please contact administrator."
            )

        if not agent:
            db_logger.error(f"Agent not found: {login.agent_id}")
            raise HTTPException(
                status_code=401,
                detail="❌ Agent ID not found. Please check your credentials."
            )

        # Determine softphone heartbeat timeout (from agent's campaign, default 30)
        softphone_heartbeat = 30
        try:
            # First get agent's campaign_id (if column exists)
            agent_campaign = db.execute(
                text("SELECT campaign_id FROM agents WHERE agent_id = :agent_id"),
                {"agent_id": login.agent_id}
            ).first()
            if agent_campaign and agent_campaign.campaign_id:
                campaign = db.execute(
                    text("SELECT softphone_heartbeat FROM campaigns WHERE id = :campaign_id"),
                    {"campaign_id": agent_campaign.campaign_id}
                ).first()
                if campaign and campaign.softphone_heartbeat:
                    softphone_heartbeat = campaign.softphone_heartbeat
                    app_logger.info(f"Agent {login.agent_id} uses campaign heartbeat={softphone_heartbeat}s")
        except Exception as e:
            app_logger.warning(f"Could not retrieve softphone_heartbeat for agent {login.agent_id}: {e}")

        # Verify password
        computed_md5 = hashlib.md5(login.password.encode()).hexdigest()
        if computed_md5 != agent.password_hash:
            db_logger.error(f"Wrong password for: {login.agent_id}")
            raise HTTPException(
                status_code=401,
                detail="❌ Incorrect password. Please try again."
            )

        # Check softphone registration
        is_registered = check_softphone_registration(login.agent_id)

        if not is_registered:
            app_logger.warning(f"Login blocked: Agent {login.agent_id} softphone not registered")
            raise HTTPException(
                status_code=400,
                detail="⚠️ Please login through your softphone first. Your SIP extension is not registered with FreeSWITCH."
            )

        app_logger.info(f"✅ Softphone verified for agent {login.agent_id}")

        # Set callcenter status to Available on successful login
        set_callcenter_status(login.agent_id, "Available")

        # Update database
        try:
            db.execute(
                text("UPDATE agents SET last_login = NOW(), status = 'Available' WHERE agent_id = :agent_id"),
                {"agent_id": login.agent_id}
            )
            db.commit()
            db_logger.info(f"Agent {login.agent_id} status updated in database")
        except Exception as db_error:
            app_logger.error(f"Database update error: {db_error}")

        # Store in Redis (inline operation)
        if REDIS_AVAILABLE:
            try:
                key = f"agent:{login.agent_id}"
                redis_client.hset(key, mapping={
                    "full_name": agent.full_name,
                    "extension": agent.extension,
                    "role": agent.role,
                    "status": "Available",
                    "login_time": datetime.now().isoformat()
                })
                redis_client.expire(key, 28800)  # 8 hours
                redis_client.sadd("online_agents", login.agent_id)
                app_logger.info(f"✅ Redis: Agent {login.agent_id} stored")
            except Exception as redis_error:
                app_logger.error(f"Redis error: {redis_error}")

        # Create token
        access_token = jwt.encode(
            {"sub": agent.agent_id, "exp": datetime.utcnow() + timedelta(hours=8)},
            SECRET_KEY,
            algorithm=ALGORITHM
        )

        app_logger.info(f"Login successful: {login.agent_id}")

        return {
            "success": True,
            "message": "✅ Login successful",
            "timestamp": datetime.now().isoformat(),
            "access_token": access_token,
            "token_type": "bearer",
            "softphone_heartbeat": softphone_heartbeat,
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
        app_logger.error(f"Unexpected login error: {e}")
        raise HTTPException(
            status_code=500,
            detail="⚠️ Internal server error. Please try again later."
        )
    finally:
        db.close()

@app.post("/api/auth/logout/manual")
def agent_logout_manual(logout: LogoutRequest):
    db = SessionLocal()
    try:
        app_logger.info(f"Manual logout: {logout.agent_id}")

        # Set callcenter status to LoggedOut in FreeSWITCH
        set_callcenter_status(logout.agent_id, "LoggedOut")

        try:
            db.execute(
                text("UPDATE agents SET status = 'LoggedOut', last_logout = NOW() WHERE agent_id = :agent_id"),
                {"agent_id": logout.agent_id}
            )
            db.commit()
            db_logger.info(f"Agent {logout.agent_id} logged out from database")
        except Exception as db_error:
            app_logger.error(f"Database error on logout: {db_error}")
            raise HTTPException(
                status_code=503,
                detail="Database error during logout"
            )

        # Remove from Redis (inline operation)
        if REDIS_AVAILABLE:
            try:
                redis_client.delete(f"agent:{logout.agent_id}")
                redis_client.srem("online_agents", logout.agent_id)
                app_logger.info(f"✅ Redis: Agent {logout.agent_id} removed")
            except Exception as e:
                app_logger.error(f"❌ Redis remove error: {e}")

        return {
            "success": True,
            "message": f"✅ Agent {logout.agent_id} logged out successfully",
            "timestamp": datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        app_logger.error(f"Logout error: {e}")
        raise HTTPException(
            status_code=500,
            detail="⚠️ Logout failed. Please try again."
        )
    finally:
        db.close()

@app.post("/api/agent/heartbeat")
async def agent_heartbeat(request: Request):
    """Heartbeat endpoint - frontend calls every 30 seconds"""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token")

    token = auth_header.split(" ")[1]
    agent_id = verify_token(token)

    if not agent_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Check if softphone is still registered
    is_registered = check_softphone_registration(agent_id)

    if not is_registered:
        # Force logout
        logout_agent(agent_id)
        raise HTTPException(
            status_code=401,
            detail="Softphone disconnected. Session terminated."
        )

    # Update last heartbeat in Redis (optional - kept for potential future use)
    if REDIS_AVAILABLE:
        redis_client.hset(f"agent:{agent_id}", "last_heartbeat", datetime.now().isoformat())

    return {
        "success": True,
        "softphone_registered": True,
        "agent_id": agent_id,
        "session_expires": (datetime.now() + timedelta(hours=8)).isoformat(),
        "timestamp": datetime.now().isoformat()
    }

@app.websocket("/ws/agent/{agent_id}")
async def websocket_endpoint(websocket: WebSocket, agent_id: str):
    """WebSocket endpoint for real-time agent status updates"""
    client_id = f"{agent_id}_{datetime.now().timestamp()}"

    try:
        await manager.connect(websocket, agent_id, client_id)

        # Send initial status
        is_registered = check_softphone_registration(agent_id)
        await manager.send_personal_message({
            "type": "connection_established",
            "agent_id": agent_id,
            "softphone_registered": is_registered,
            "timestamp": datetime.now().isoformat()
        }, agent_id)

        # Keep connection alive and listen for client messages
        while True:
            data = await websocket.receive_text()

            # Handle ping/pong
            if data == "ping":
                await websocket.send_text("pong")
            else:
                # Process any client messages
                ws_logger.info(f"Received from {agent_id}: {data}")

    except WebSocketDisconnect:
        ws_logger.info(f"WebSocket disconnected for {agent_id}")
    except Exception as e:
        ws_logger.error(f"WebSocket error for {agent_id}: {e}")
    finally:
        manager.disconnect(client_id)

@app.get("/api/agents/online")
def get_online_agents():
    if REDIS_AVAILABLE:
        try:
            online_agents = list(redis_client.smembers("online_agents"))

            # Enhance with real-time registration status
            agent_details = []
            for agent_id in online_agents:
                is_registered = check_softphone_registration(agent_id)
                agent_details.append({
                    "agent_id": agent_id,
                    "softphone_registered": is_registered,
                    "details": redis_client.hgetall(f"agent:{agent_id}")
                })

            return {
                "success": True,
                "timestamp": datetime.now().isoformat(),
                "online_agents": online_agents,
                "count": len(online_agents),
                "agent_details": agent_details
            }
        except Exception as e:
            app_logger.error(f"Redis error in get_online_agents: {e}")
            return {
                "success": False,
                "error": "Redis connection failed",
                "online_agents": [],
                "count": 0
            }
    else:
        return {
            "success": False,
            "error": "Redis not available - real-time features disabled",
            "online_agents": [],
            "count": 0
        }

@app.get("/api/health")
def health():
    db_status = "connected"
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
    except:
        db_status = "disconnected"

    return {
        "success": True,
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "services": {
            "database": db_status,
            "redis": "connected" if REDIS_AVAILABLE else "disconnected",
            "websocket": "active",
            "freeswitch_monitor": "running"
        }
    }

# Debug endpoint - only available in development environment
if ENVIRONMENT == "development":
    @app.get("/api/debug/check-registration/{agent_id}")
    async def debug_check_registration(agent_id: str):
        """Debug endpoint to test registration check (Development only)"""
        result = check_softphone_registration(agent_id)
        return {
            "agent_id": agent_id,
            "is_registered": result,
            "timestamp": datetime.now().isoformat(),
            "environment": ENVIRONMENT
        }

if __name__ == "__main__":
    print("\n" + "="*60)
    print("FreeSWITCH Manager API Server with CallCenter Integration")
    print("="*60)
    print(f"Server: http://0.0.0.0:8000")
    print(f"Environment: {ENVIRONMENT}")
    print(f"Redis: {'✅ Available' if REDIS_AVAILABLE else '❌ Not available'}")
    print(f"Softphone Verification: ✅ Enabled")
    print(f"Real-time Monitoring: ✅ Enabled")
    print(f"Logs: /tmp/fs_logs/")
    print("="*60 + "\n")

    uvicorn.run(app, host="0.0.0.0", port=8000)
