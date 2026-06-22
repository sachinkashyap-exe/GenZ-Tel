from fastapi import FastAPI, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.security import HTTPBearer
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
from typing import Dict, Optional
import time

# ========== CONFIGURATION ==========
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-12345")
ALGORITHM = "HS256"
DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://root:hradmin@localhost/fs_manager")
FS_HOST = os.getenv("FS_HOST", "192.168.1.248")
FS_PORT = int(os.getenv("FS_PORT", "8021"))
FS_PASSWORD = os.getenv("FS_PASSWORD", "ClueCon")
ENVIRONMENT = os.getenv("ENVIRONMENT", "production")

LOG_DIR = "/tmp/fs_logs"
Path(LOG_DIR).mkdir(parents=True, exist_ok=True)

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

# ========== DATABASE ==========
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ========== REDIS (optional) ==========
REDIS_AVAILABLE = False
redis_client = None
try:
    import redis
    redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True, socket_connect_timeout=2)
    redis_client.ping()
    REDIS_AVAILABLE = True
    app_logger.info("✅ Redis connected")
except Exception as e:
    app_logger.warning(f"⚠️ Redis not available: {e}")

# ========== FASTAPI APP ==========
@asynccontextmanager
async def lifespan(app: FastAPI):
    app_logger.info("🚀 Server starting up...")
    yield
    app_logger.info("🛑 Server shutting down...")
    if hasattr(app, 'fs_monitor'):
        app.fs_monitor.stop()
        app_logger.info("✅ FreeSWITCH monitor stopped")

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": exc.detail, "timestamp": datetime.now().isoformat()}
    )

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = datetime.now()
    response = await call_next(request)
    duration = (datetime.now() - start).total_seconds()
    api_logger.info(f"{request.method} {request.url.path} -> {response.status_code} ({duration:.3f}s)")
    return response

security = HTTPBearer()

# ========== WEBSOCKET MANAGER ==========
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.agent_sessions: Dict[str, str] = {}

    async def connect(self, websocket: WebSocket, agent_id: str, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        self.agent_sessions[agent_id] = client_id
        ws_logger.info(f"✅ WebSocket connected for agent {agent_id}")

    def disconnect(self, client_id: str):
        agent_id = next((aid for aid, cid in self.agent_sessions.items() if cid == client_id), None)
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

# ========== FREESWITCH HELPERS ==========
def set_callcenter_status(agent_id, status):
    try:
        cmd = f'/usr/local/freeswitch/bin/fs_cli -x "callcenter_config agent set status {agent_id}@{FS_HOST} {status}"'
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        if "+OK" in result.stdout:
            return True
        else:
            ws_logger.warning(f"Failed to set callcenter status: {result.stdout}")
            return False
    except Exception as e:
        ws_logger.error(f"Error setting callcenter status: {e}")
        return False

def check_softphone_registration(agent_id):
    try:
        cmd = f'/usr/local/freeswitch/bin/fs_cli -x "sofia_contact user/{agent_id}@{FS_HOST}"'
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        output = result.stdout.strip()
        if output and "sofia/internal/sip:" in output:
            return True
        else:
            return False
    except Exception as e:
        app_logger.error(f"Error checking registration for {agent_id}: {e}")
        return False

def logout_agent(agent_id: str, db_session=None):
    should_close = False
    if db_session is None:
        db_session = SessionLocal()
        should_close = True
    try:
        db_session.execute(
            text("UPDATE agents SET status = 'LoggedOut', last_logout = NOW() WHERE agent_id = :agent_id"),
            {"agent_id": agent_id}
        )
        db_session.commit()
        if REDIS_AVAILABLE:
            redis_client.delete(f"agent:{agent_id}")
            redis_client.srem("online_agents", agent_id)
        set_callcenter_status(agent_id, "LoggedOut")
        # WebSocket notification
        asyncio.create_task(manager.send_personal_message({
            "type": "force_logout",
            "message": "Softphone disconnected. You have been logged out.",
            "timestamp": datetime.now().isoformat()
        }, agent_id))
        app_logger.info(f"Force logout completed for agent {agent_id}")
    except Exception as e:
        app_logger.error(f"Error force logging out {agent_id}: {e}")
    finally:
        if should_close:
            db_session.close()

# ========== FREESWITCH EVENT MONITOR ==========
class FreeSWITCHMonitor:
    def __init__(self):
        self.running = False
        self.thread = None
        self.registered_agents = {}

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._monitor_events, daemon=True)
        self.thread.start()
        app_logger.info("📡 FreeSWITCH event monitor started")

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)

    def _send_ws(self, agent_id, message):
        try:
            asyncio.create_task(manager.send_personal_message(message, agent_id))
        except RuntimeError:
            asyncio.run(manager.send_personal_message(message, agent_id))

    def _monitor_events(self):
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
                                        self.registered_agents[agent_id] = time.time()
                                        self._send_ws(agent_id, {"type": "softphone_registered", "agent_id": agent_id})
                                    elif event_name == "UNREGISTER":
                                        if agent_id in self.registered_agents:
                                            del self.registered_agents[agent_id]
                                        logout_agent(agent_id)
                                        self._send_ws(agent_id, {"type": "softphone_unregistered", "agent_id": agent_id})
                    time.sleep(5)
                except Exception as e:
                    ws_logger.error(f"ESL event loop error: {e}")
                    time.sleep(5)
        except ImportError:
            ws_logger.warning("ESL module not available. Using polling mode.")
            self._monitor_by_polling()

    def _monitor_by_polling(self):
        while self.running:
            try:
                cmd = '/usr/local/freeswitch/bin/fs_cli -x "sofia status profile internal reg"'
                result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
                output = result.stdout
                current_registered = set()
                for line in output.split('\n'):
                    if 'sip:' in line and 'User:' in line:
                        parts = line.split('User:')
                        if len(parts) > 1:
                            user = parts[1].strip().split('@')[0]
                            if user.isdigit():
                                current_registered.add(user)
                for agent_id in list(self.registered_agents.keys()):
                    if agent_id not in current_registered:
                        ws_logger.warning(f"Agent {agent_id} unregistered (polling detected)")
                        logout_agent(agent_id)
                        del self.registered_agents[agent_id]
                self.registered_agents = {aid: time.time() for aid in current_registered}
                time.sleep(10)
            except Exception as e:
                ws_logger.error(f"Polling error: {e}")
                time.sleep(10)

fs_monitor = FreeSWITCHMonitor()
fs_monitor.start()
app.fs_monitor = fs_monitor

# ========== PYDANTIC MODELS ==========
class LoginRequest(BaseModel):
    agent_id: str
    password: str

class LogoutRequest(BaseModel):
    agent_id: str

class AgentCreate(BaseModel):
    agent_id: str
    full_name: str
    password: str
    extension: str
    role: str = "agent"
    campaign_id: int = 1
    webrtc_login: Optional[int] = None  # will be taken from campaign, ignore

class AgentUpdate(BaseModel):
    full_name: Optional[str] = None
    password: Optional[str] = None
    extension: Optional[str] = None
    role: Optional[str] = None
    campaign_id: Optional[int] = None

class CampaignCreate(BaseModel):
    name: str
    campaign_name: str
    dialplan: str = "XML"
    queue_strategy: str = "round_robin"
    softphone_heartbeat: int = 30
    webrtc_login: int = 0

class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    campaign_name: Optional[str] = None
    dialplan: Optional[str] = None
    queue_strategy: Optional[str] = None
    softphone_heartbeat: Optional[int] = None
    webrtc_login: Optional[int] = None

# ========== HELPER ==========
def verify_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except:
        return None

def require_admin(credentials: HTTPBearer = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin privileges required")
        return payload["sub"]
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ========== AGENT API ENDPOINTS ==========
@app.post("/api/auth/login")
async def agent_login(login: LoginRequest):
    db = SessionLocal()
    try:
        app_logger.info(f"Login attempt: {login.agent_id}")
        # Fetch agent with campaign info
        result = db.execute(
            text("SELECT a.*, c.webrtc_login, c.softphone_heartbeat FROM agents a LEFT JOIN campaigns c ON a.campaign_id = c.id WHERE a.agent_id = :agent_id"),
            {"agent_id": login.agent_id}
        )
        row = result.first()
        if not row:
            raise HTTPException(status_code=401, detail="Agent ID not found")
        agent = row
        # Verify password
        computed_md5 = hashlib.md5(login.password.encode()).hexdigest()
        if computed_md5 != agent.password_hash:
            raise HTTPException(status_code=401, detail="Incorrect password")

        webrtc_login = getattr(agent, 'webrtc_login', 0)
        softphone_heartbeat = getattr(agent, 'softphone_heartbeat', 30)

        if not webrtc_login:
            is_registered = check_softphone_registration(login.agent_id)
            if not is_registered:
                app_logger.warning(f"Login blocked: Agent {login.agent_id} softphone not registered")
                raise HTTPException(status_code=400, detail="⚠️ Please login through your softphone first. Your SIP extension is not registered with FreeSWITCH.")
            app_logger.info(f"✅ Softphone verified for agent {login.agent_id}")
        else:
            app_logger.info(f"🔓 WebRTC mode enabled for agent {login.agent_id} - SIP check skipped")

        # Set callcenter status and update DB
        set_callcenter_status(login.agent_id, "Available")
        db.execute(
            text("UPDATE agents SET last_login = NOW(), status = 'Available' WHERE agent_id = :agent_id"),
            {"agent_id": login.agent_id}
        )
        db.commit()

        if REDIS_AVAILABLE:
            redis_client.hset(f"agent:{login.agent_id}", mapping={
                "full_name": agent.full_name,
                "extension": agent.extension,
                "role": agent.role,
                "status": "Available"
            })
            redis_client.sadd("online_agents", login.agent_id)

        access_token = jwt.encode(
            {"sub": agent.agent_id, "role": agent.role, "exp": datetime.utcnow() + timedelta(hours=8)},
            SECRET_KEY,
            algorithm=ALGORITHM
        )

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
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db.close()

@app.post("/api/auth/logout/manual")
def agent_logout_manual(logout: LogoutRequest):
    db = SessionLocal()
    try:
        set_callcenter_status(logout.agent_id, "LoggedOut")
        db.execute(
            text("UPDATE agents SET status = 'LoggedOut', last_logout = NOW() WHERE agent_id = :agent_id"),
            {"agent_id": logout.agent_id}
        )
        db.commit()
        if REDIS_AVAILABLE:
            redis_client.delete(f"agent:{logout.agent_id}")
            redis_client.srem("online_agents", logout.agent_id)
        return {"success": True, "message": f"Agent {logout.agent_id} logged out"}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Logout failed")
    finally:
        db.close()

@app.post("/api/agent/heartbeat")
async def agent_heartbeat(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token")
    token = auth_header.split(" ")[1]
    agent_id = verify_token(token)
    if not agent_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    db = SessionLocal()
    try:
        # Get webrtc_login from agent's campaign
        row = db.execute(
            text("SELECT c.webrtc_login FROM agents a LEFT JOIN campaigns c ON a.campaign_id = c.id WHERE a.agent_id = :agent_id"),
            {"agent_id": agent_id}
        ).first()
        webrtc_login = row.webrtc_login if row else 0
    finally:
        db.close()

    if webrtc_login == 0:
        if not check_softphone_registration(agent_id):
            logout_agent(agent_id)
            raise HTTPException(status_code=401, detail="Softphone disconnected. Session terminated.")

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
    client_id = f"{agent_id}_{datetime.now().timestamp()}"
    try:
        await manager.connect(websocket, agent_id, client_id)
        # Send initial registration status
        is_registered = check_softphone_registration(agent_id)
        await manager.send_personal_message({
            "type": "connection_established",
            "agent_id": agent_id,
            "softphone_registered": is_registered,
            "timestamp": datetime.now().isoformat()
        }, agent_id)
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
            else:
                ws_logger.info(f"Received from {agent_id}: {data}")
    except WebSocketDisconnect:
        ws_logger.info(f"WebSocket disconnected for {agent_id}")
    finally:
        manager.disconnect(client_id)

@app.get("/api/agents/online")
def get_online_agents():
    if not REDIS_AVAILABLE:
        return {"success": False, "online_agents": [], "count": 0}
    try:
        online = list(redis_client.smembers("online_agents"))
        details = []
        for aid in online:
            reg = check_softphone_registration(aid)
            details.append({
                "agent_id": aid,
                "softphone_registered": reg,
                "details": redis_client.hgetall(f"agent:{aid}")
            })
        return {"success": True, "online_agents": online, "count": len(online), "agent_details": details}
    except Exception as e:
        return {"success": False, "error": str(e), "online_agents": [], "count": 0}

# ========== ADMIN API ENDPOINTS ==========
@app.get("/api/admin/agents", dependencies=[Depends(require_admin)])
def admin_list_agents():
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT a.agent_id, a.full_name, a.extension, a.role, a.status, a.campaign_id,
                   c.name as campaign_name, c.webrtc_login
            FROM agents a
            LEFT JOIN campaigns c ON a.campaign_id = c.id
        """))
        agents = [dict(r._mapping) for r in rows]
        return {"success": True, "agents": agents}
    finally:
        db.close()

@app.post("/api/admin/agents", dependencies=[Depends(require_admin)])
def admin_create_agent(agent: AgentCreate):
    db = SessionLocal()
    try:
        existing = db.execute(text("SELECT agent_id FROM agents WHERE agent_id = :aid"), {"aid": agent.agent_id}).first()
        if existing:
            raise HTTPException(400, "Agent ID already exists")
        password_hash = hashlib.md5(agent.password.encode()).hexdigest()
        db.execute(
            text("INSERT INTO agents (agent_id, full_name, password_hash, extension, role, campaign_id) VALUES (:aid, :name, :pwd, :ext, :role, :cid)"),
            {"aid": agent.agent_id, "name": agent.full_name, "pwd": password_hash, "ext": agent.extension, "role": agent.role, "cid": agent.campaign_id}
        )
        db.commit()
        return {"success": True, "message": "Agent created"}
    finally:
        db.close()

@app.put("/api/admin/agents/{agent_id}", dependencies=[Depends(require_admin)])
def admin_update_agent(agent_id: str, agent: AgentUpdate):
    db = SessionLocal()
    try:
        updates = []
        params = {"aid": agent_id}
        if agent.full_name:
            updates.append("full_name = :name")
            params["name"] = agent.full_name
        if agent.password:
            params["pwd"] = hashlib.md5(agent.password.encode()).hexdigest()
            updates.append("password_hash = :pwd")
        if agent.extension is not None:
            updates.append("extension = :ext")
            params["ext"] = agent.extension
        if agent.role:
            updates.append("role = :role")
            params["role"] = agent.role
        if agent.campaign_id is not None:
            updates.append("campaign_id = :cid")
            params["cid"] = agent.campaign_id
        if updates:
            db.execute(text(f"UPDATE agents SET {', '.join(updates)} WHERE agent_id = :aid"), params)
            db.commit()
        return {"success": True, "message": "Agent updated"}
    finally:
        db.close()

@app.delete("/api/admin/agents/{agent_id}", dependencies=[Depends(require_admin)])
def admin_delete_agent(agent_id: str):
    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM agents WHERE agent_id = :aid"), {"aid": agent_id})
        db.commit()
        return {"success": True, "message": "Agent deleted"}
    finally:
        db.close()

@app.get("/api/admin/campaigns", dependencies=[Depends(require_admin)])
def admin_list_campaigns():
    db = SessionLocal()
    try:
        rows = db.execute(text("SELECT id, name, campaign_name, dialplan, queue_strategy, softphone_heartbeat, webrtc_login FROM campaigns"))
        campaigns = [dict(r._mapping) for r in rows]
        return {"success": True, "campaigns": campaigns}
    finally:
        db.close()

@app.post("/api/admin/campaigns", dependencies=[Depends(require_admin)])
def admin_create_campaign(camp: CampaignCreate):
    db = SessionLocal()
    try:
        db.execute(
            text("INSERT INTO campaigns (name, campaign_name, dialplan, queue_strategy, softphone_heartbeat, webrtc_login) VALUES (:name, :cname, :dial, :strat, :hb, :webrtc)"),
            {"name": camp.name, "cname": camp.campaign_name, "dial": camp.dialplan, "strat": camp.queue_strategy, "hb": camp.softphone_heartbeat, "webrtc": camp.webrtc_login}
        )
        db.commit()
        return {"success": True, "message": "Campaign created"}
    finally:
        db.close()

@app.put("/api/admin/campaigns/{campaign_id}", dependencies=[Depends(require_admin)])
def admin_update_campaign(campaign_id: int, camp: CampaignUpdate):
    db = SessionLocal()
    try:
        updates = []
        params = {"cid": campaign_id}
        for field in ['name', 'campaign_name', 'dialplan', 'queue_strategy', 'softphone_heartbeat', 'webrtc_login']:
            value = getattr(camp, field, None)
            if value is not None:
                updates.append(f"{field} = :{field}")
                params[field] = value
        if updates:
            db.execute(text(f"UPDATE campaigns SET {', '.join(updates)} WHERE id = :cid"), params)
            db.commit()
        return {"success": True, "message": "Campaign updated"}
    finally:
        db.close()

@app.delete("/api/admin/campaigns/{campaign_id}", dependencies=[Depends(require_admin)])
def admin_delete_campaign(campaign_id: int):
    db = SessionLocal()
    try:
        # Check if any agent uses this campaign
        used = db.execute(text("SELECT agent_id FROM agents WHERE campaign_id = :cid LIMIT 1"), {"cid": campaign_id}).first()
        if used:
            raise HTTPException(400, "Cannot delete campaign: agents still assigned")
        db.execute(text("DELETE FROM campaigns WHERE id = :cid"), {"cid": campaign_id})
        db.commit()
        return {"success": True, "message": "Campaign deleted"}
    finally:
        db.close()

@app.get("/api/admin/callcenter/agents-status", dependencies=[Depends(require_admin)])
def admin_agents_status():
    try:
        reg_cmd = '/usr/local/freeswitch/bin/fs_cli -x "sofia status profile internal reg"'
        reg_result = subprocess.run(reg_cmd, shell=True, capture_output=True, text=True, timeout=5)
        registered = []
        for line in reg_result.stdout.split('\n'):
            if 'sip:' in line and 'User:' in line:
                parts = line.split('User:')
                if len(parts) > 1:
                    user = parts[1].strip().split('@')[0]
                    registered.append(user)
        cc_cmd = '/usr/local/freeswitch/bin/fs_cli -x "callcenter_config agent list"'
        cc_result = subprocess.run(cc_cmd, shell=True, capture_output=True, text=True, timeout=5)
        agent_status = {}
        for line in cc_result.stdout.split('\n'):
            if '|' in line:
                parts = [p.strip() for p in line.split('|')]
                if len(parts) >= 3:
                    agent_status[parts[0]] = parts[1]
        return {"success": True, "registered_softphones": registered, "callcenter_agents": agent_status}
    except Exception as e:
        return {"success": False, "error": str(e)}

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

# ========== SINGLE-FILE ADMIN HTML ==========
ADMIN_HTML = """<!DOCTYPE html>
<html>
<head><title>Call Center Admin</title><style>
* { box-sizing: border-box; }
body { background: #0f172a; color: #f1f5f9; font-family: system-ui; margin: 0; padding: 20px; }
.container { max-width: 1400px; margin: 0 auto; }
.login-box, .main-panel { background: #1e293b; border-radius: 16px; padding: 24px; }
.login-box { max-width: 400px; margin: 100px auto; }
h1, h2 { color: #facc15; margin-top: 0; }
input, select, button { width: 100%; padding: 10px; margin: 8px 0; border-radius: 8px; border: none; background: #334155; color: white; }
button { background: #3b82f6; font-weight: bold; cursor: pointer; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; }
th, td { text-align: left; padding: 10px; border-bottom: 1px solid #334155; }
th { background: #0f172a; }
.tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid #334155; padding-bottom: 8px; }
.tab { background: #334155; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
.tab.active { background: #3b82f6; }
.card { background: #0f172a; padding: 16px; border-radius: 12px; margin-bottom: 20px; }
.flex { display: flex; gap: 12px; align-items: center; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
button.small { width: auto; padding: 4px 12px; margin: 0 4px; }
</style>
</head>
<body><div id="app"></div>
<script>
const API_BASE='/api';
function getToken(){return localStorage.getItem('admin_token');}
function setToken(t){localStorage.setItem('admin_token',t);}
function getAdmin(){return JSON.parse(localStorage.getItem('admin')||'{}');}
function setAdmin(a){localStorage.setItem('admin',JSON.stringify(a));}
function clearAuth(){localStorage.removeItem('admin_token');localStorage.removeItem('admin');}
async function apiCall(method,path,body=null){
    const headers={'Content-Type':'application/json'};
    const token=getToken();
    if(token)headers['Authorization']=`Bearer ${token}`;
    const res=await fetch(`${API_BASE}${path}`,{method,headers,body:body?JSON.stringify(body):undefined});
    if(res.status===401){clearAuth();renderLogin();throw new Error('Session expired');}
    const data=await res.json();
    if(!res.ok)throw new Error(data.detail||data.message||'Request failed');
    return data;
}
async function handleLogin(e){
    e.preventDefault();
    const agent_id=document.getElementById('agent_id').value;
    const password=document.getElementById('password').value;
    try{
        const res=await fetch(`${API_BASE}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent_id,password})});
        const data=await res.json();
        if(!res.ok)throw new Error(data.detail||'Login failed');
        if(data.agent?.role!=='admin')throw new Error('Admin access required');
        setToken(data.access_token);
        setAdmin(data.agent);
        renderDashboard();
    }catch(err){document.getElementById('loginError').innerText=err.message;}
}
function renderLogin(){
    document.getElementById('app').innerHTML=`<div class="login-box"><h2>🔐 Admin Login</h2><form id="loginForm"><input type="text" id="agent_id" placeholder="Agent ID" required><input type="password" id="password" placeholder="Password" required><div id="loginError" style="color:#f87171"></div><button type="submit">Login</button></form></div>`;
    document.getElementById('loginForm').addEventListener('submit',handleLogin);
}
let currentTab='agents';
async function fetchAgents(){return (await apiCall('GET','/admin/agents')).agents;}
async function fetchCampaigns(){return (await apiCall('GET','/admin/campaigns')).campaigns;}
async function fetchLiveStatus(){return await apiCall('GET','/admin/callcenter/agents-status');}
async function createAgent(agent){return await apiCall('POST','/admin/agents',agent);}
async function updateAgent(id,agent){return await apiCall('PUT',`/admin/agents/${id}`,agent);}
async function deleteAgent(id){return await apiCall('DELETE',`/admin/agents/${id}`);}
async function createCampaign(camp){return await apiCall('POST','/admin/campaigns',camp);}
async function updateCampaign(id,camp){return await apiCall('PUT',`/admin/campaigns/${id}`,camp);}
async function deleteCampaign(id){return await apiCall('DELETE',`/admin/campaigns/${id}`);}
async function renderAgentsTab(){
    const agents=await fetchAgents();
    const campaigns=await fetchCampaigns();
    let html=`<div class="card"><h3>➕ Add New Agent</h3><form id="agentForm"><div class="grid"><input type="text" id="agent_id" placeholder="Agent ID" required><input type="text" id="full_name" placeholder="Full Name" required><input type="password" id="password" placeholder="Password" required><input type="text" id="extension" placeholder="Extension"><select id="role"><option value="agent">Agent</option><option value="admin">Admin</option><option value="supervisor">Supervisor</option></select><select id="campaign_id"><option value="">-- No Campaign --</option>${campaigns.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select></div><button type="submit">Create Agent</button></form></div><div class="card"><h3>📋 Existing Agents</h3><table><thead><tr><th>ID</th><th>Name</th><th>Ext</th><th>Role</th><th>Campaign</th><th>WebRTC Mode</th><th>Actions</th></tr></thead><tbody id="agentsTableBody"></tbody></table></div>`;
    document.getElementById('tabContent').innerHTML=html;
    const tbody=document.getElementById('agentsTableBody');
    tbody.innerHTML=agents.map(a=>`<tr><td>${a.agent_id}</td><td>${a.full_name}</td><td>${a.extension||'-'}</td><td>${a.role}</td><td>${a.campaign_name||'-'}</td><td>${a.webrtc_login?'✅ WebRTC':'📞 Softphone'}</td><td><button class="small" onclick="editAgent('${a.agent_id}')">✏️</button><button class="small" onclick="deleteAgentById('${a.agent_id}')">🗑️</button></td></tr>`).join('');
    document.getElementById('agentForm').addEventListener('submit',async(e)=>{
        e.preventDefault();
        const newAgent={agent_id:document.getElementById('agent_id').value,full_name:document.getElementById('full_name').value,password:document.getElementById('password').value,extension:document.getElementById('extension').value,role:document.getElementById('role').value,campaign_id:parseInt(document.getElementById('campaign_id').value)||null};
        try{await createAgent(newAgent);renderAgentsTab();}catch(err){alert(err.message);}
    });
    window.editAgent=async(id)=>{
        const agent=agents.find(a=>a.agent_id===id);
        if(!agent)return;
        const newCamp=prompt("Campaign ID (numeric):",agent.campaign_id);
        if(newCamp!==null){
            try{await updateAgent(id,{campaign_id:parseInt(newCamp)||null});renderAgentsTab();}catch(err){alert(err.message);}
        }
    };
    window.deleteAgentById=async(id)=>{if(confirm("Delete agent?"))try{await deleteAgent(id);renderAgentsTab();}catch(err){alert(err.message);}};
}
async function renderCampaignsTab(){
    const campaigns=await fetchCampaigns();
    let html=`<div class="card"><h3>➕ Add New Campaign</h3><form id="campaignForm"><div class="grid"><input type="text" id="name" placeholder="Internal Name" required><input type="text" id="campaign_name" placeholder="Display Name" required><input type="text" id="dialplan" placeholder="Dialplan" value="XML"><select id="queue_strategy"><option value="round_robin">Round Robin</option><option value="longest_idle">Longest Idle</option><option value="tiered">Tiered</option></select><input type="number" id="softphone_heartbeat" placeholder="Heartbeat (sec)" value="30"><label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="webrtc_login"> WebRTC Login (skip SIP check)</label></div><button type="submit">Create Campaign</button></form></div><div class="card"><h3>📋 Existing Campaigns</h3><table><thead><tr><th>ID</th><th>Name</th><th>Display Name</th><th>Strategy</th><th>Heartbeat</th><th>Login Mode</th><th>Actions</th></tr></thead><tbody id="campaignsTableBody"></tbody></table></div>`;
    document.getElementById('tabContent').innerHTML=html;
    const tbody=document.getElementById('campaignsTableBody');
    tbody.innerHTML=campaigns.map(c=>`<tr><td>${c.id}</td><td>${c.name}</td><td>${c.campaign_name}</td><td>${c.queue_strategy}</td><td>${c.softphone_heartbeat}s</td><td>${c.webrtc_login?'✅ WebRTC':'📞 Softphone'}</td><td><button class="small" onclick="editCampaign(${c.id})">✏️</button><button class="small" onclick="deleteCampaignById(${c.id})">🗑️</button></td></tr>`).join('');
    document.getElementById('campaignForm').addEventListener('submit',async(e)=>{
        e.preventDefault();
        const newCamp={name:document.getElementById('name').value,campaign_name:document.getElementById('campaign_name').value,dialplan:document.getElementById('dialplan').value,queue_strategy:document.getElementById('queue_strategy').value,softphone_heartbeat:parseInt(document.getElementById('softphone_heartbeat').value)||30,webrtc_login:document.getElementById('webrtc_login').checked?1:0};
        try{await createCampaign(newCamp);renderCampaignsTab();}catch(err){alert(err.message);}
    });
    window.editCampaign=async(id)=>{
        const camp=campaigns.find(c=>c.id===id);
        if(!camp)return;
        const newHb=prompt("Softphone heartbeat (seconds):",camp.softphone_heartbeat);
        const newWebrtc=confirm("Enable WebRTC login mode (skip SIP check)?\nOK=Yes, Cancel=No");
        if(newHb!==null&&!isNaN(newHb)){
            try{await updateCampaign(id,{softphone_heartbeat:parseInt(newHb),webrtc_login:newWebrtc?1:0});renderCampaignsTab();}catch(err){alert(err.message);}
        }
    };
    window.deleteCampaignById=async(id)=>{if(confirm("Delete campaign?"))try{await deleteCampaign(id);renderCampaignsTab();}catch(err){alert(err.message);}};
}
async function renderLiveStatusTab(){
    let status={registered_softphones:[],callcenter_agents:{}};
    try{status=await fetchLiveStatus();}catch(e){}
    const html=`<div class="card"><h3>📞 FreeSWITCH Registration</h3><ul>${status.registered_softphones.map(s=>`<li>✅ ${s}</li>`).join('')||'<li>No registered softphones</li>'}</ul></div><div class="card"><h3>📊 CallCenter Agent Status</h3><ul>${Object.entries(status.callcenter_agents).map(([a,st])=>`<li><strong>${a}</strong>: ${st}</li>`).join('')||'<li>No data</li>'}</ul></div><button id="refreshStatus" class="small">Refresh</button>`;
    document.getElementById('tabContent').innerHTML=html;
    document.getElementById('refreshStatus')?.addEventListener('click',()=>renderLiveStatusTab());
}
async function switchTab(tab){
    currentTab=tab;
    document.querySelectorAll('.tab').forEach((t,i)=>{if(i===0&&tab==='agents'||i===1&&tab==='campaigns'||i===2&&tab==='status')t.classList.add('active');else t.classList.remove('active');});
    if(tab==='agents')await renderAgentsTab();
    else if(tab==='campaigns')await renderCampaignsTab();
    else await renderLiveStatusTab();
}
function renderDashboard(){
    const admin=getAdmin();
    document.getElementById('app').innerHTML=`<div class="main-panel"><div class="flex" style="justify-content:space-between"><h1>📞 Call Center Admin</h1><div>Welcome, ${admin.full_name} | <button id="logoutBtn" class="small">Logout</button></div></div><div class="tabs"><div class="tab active" data-tab="agents">Agents</div><div class="tab" data-tab="campaigns">Campaigns</div><div class="tab" data-tab="status">Live Status</div></div><div id="tabContent"></div></div>`;
    document.querySelectorAll('.tab').forEach(tab=>{tab.addEventListener('click',()=>switchTab(tab.getAttribute('data-tab')));});
    document.getElementById('logoutBtn').addEventListener('click',()=>{clearAuth();renderLogin();});
    switchTab('agents');
}
if(getToken()&&getAdmin().role==='admin')renderDashboard();else renderLogin();
</script>
</body>
</html>"""

@app.get("/admin", response_class=HTMLResponse)
async def serve_admin_html():
    return HTMLResponse(content=ADMIN_HTML)

if __name__ == "__main__":
    print("\n" + "="*60)
    print("FreeSWITCH Manager API Server (Campaign-level WebRTC login)")
    print("="*60)
    print(f"Server: http://0.0.0.0:8000")
    print(f"Admin UI: http://0.0.0.0:8000/admin")
    print("="*60 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)
