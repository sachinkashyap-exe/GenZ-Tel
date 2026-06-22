import os
import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import redis
from datetime import datetime
from typing import Dict, Optional

# ============================================
# Environment Variables
# ============================================
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-12345")
ALGORITHM = "HS256"
DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://root:hradmin@localhost/fs_manager")
#FS_HOST = os.getenv("FS_HOST", "127.0.0.1")
FS_HOST = os.getenv("FS_HOST", "192.168.1.248")
FS_PORT = int(os.getenv("FS_PORT", "8021"))
FS_PASSWORD = os.getenv("FS_PASSWORD", "ClueCon")
ENVIRONMENT = os.getenv("ENVIRONMENT", "production")
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))

# ============================================
# Logging Setup
# ============================================
LOG_DIR = "/tmp/fs_logs"
Path(LOG_DIR).mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(message)s')

# Create separate loggers for different components
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

admin_logger = logging.getLogger('admin')
admin_handler = logging.FileHandler(f"{LOG_DIR}/admin.log")
admin_logger.addHandler(admin_handler)

# ============================================
# Database Setup
# ============================================
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ============================================
# Redis Setup
# ============================================
REDIS_AVAILABLE = False
redis_client: Optional[redis.Redis] = None

try:
    redis_client = redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
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
# WebSocket Connection Manager (Base)
# ============================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, object] = {}
        self.agent_sessions: Dict[str, str] = {}
        self.admin_connections: Dict[str, object] = {}

    async def connect_agent(self, websocket, agent_id: str, client_id: str):
        """Connect an agent WebSocket"""
        await websocket.accept()
        self.active_connections[client_id] = websocket
        self.agent_sessions[agent_id] = client_id
        ws_logger.info(f"✅ Agent WebSocket connected: {agent_id}")

    async def connect_admin(self, websocket, admin_id: str):
        """Connect an admin dashboard WebSocket"""
        await websocket.accept()
        self.admin_connections[admin_id] = websocket
        ws_logger.info(f"✅ Admin WebSocket connected: {admin_id}")

    def disconnect(self, client_id: str):
        """Disconnect a client"""
        # Check if it's an agent
        agent_id = None
        for aid, cid in self.agent_sessions.items():
            if cid == client_id:
                agent_id = aid
                break
        if agent_id:
            del self.agent_sessions[agent_id]
        
        # Check if it's an admin
        admin_id = None
        for aid, conn in self.admin_connections.items():
            if conn == self.active_connections.get(client_id):
                admin_id = aid
                break
        if admin_id:
            del self.admin_connections[admin_id]
        
        if client_id in self.active_connections:
            del self.active_connections[client_id]
        
        ws_logger.info(f"❌ Client disconnected: {client_id}")

    async def send_to_agent(self, agent_id: str, message: dict):
        """Send message to specific agent"""
        if agent_id in self.agent_sessions:
            client_id = self.agent_sessions[agent_id]
            if client_id in self.active_connections:
                try:
                    await self.active_connections[client_id].send_json(message)
                    return True
                except Exception as e:
                    ws_logger.error(f"Error sending to agent: {e}")
                    self.disconnect(client_id)
        return False

    async def broadcast_to_admins(self, message: dict):
        """Broadcast message to all admin dashboards"""
        disconnected = []
        for admin_id, connection in self.admin_connections.items():
            try:
                await connection.send_json(message)
            except:
                disconnected.append(admin_id)
        
        for admin_id in disconnected:
            del self.admin_connections[admin_id]

    async def broadcast_to_all(self, message: dict):
        """Broadcast to both agents and admins"""
        await self.broadcast_to_admins(message)
        # Also send to relevant agents if needed

# Global connection manager instance
manager = ConnectionManager()

# ============================================
# Shared Utility Functions (Non-Agent Specific)
# ============================================
def get_db_session():
    """Get a database session"""
    return SessionLocal()

def log_error(component: str, error: Exception, context: dict = None):
    """Centralized error logging"""
    error_msg = f"{component} Error: {str(error)}"
    if context:
        error_msg += f" | Context: {context}"
    
    if component == "api":
        api_logger.error(error_msg)
    elif component == "db":
        db_logger.error(error_msg)
    elif component == "admin":
        admin_logger.error(error_msg)
    else:
        app_logger.error(error_msg)
