from fastapi import FastAPI, HTTPException, Depends, Request, WebSocket, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from contextlib import asynccontextmanager
from pydantic import BaseModel, Field
from datetime import datetime
import uvicorn
from typing import Optional
from config import FS_PORT, FS_PASSWORD

# Import all configurations
from config import (
    app_logger, ENVIRONMENT, manager, log_error,
    get_db_session, REDIS_AVAILABLE
)

# Import agent functions
from agent import (
    agent_login_endpoint, agent_logout_endpoint, agent_heartbeat_endpoint,
    agent_websocket_endpoint, FreeSWITCHAgentMonitor, force_logout_agent,
    check_softphone_registration, get_agent_info, get_agent_performance
)

# Import admin functions
from admin import (
    get_dashboard_stats, get_chart_data, get_top_agents,
    get_recent_calls, get_queue_status, get_agent_details,
    get_online_agents, admin_websocket_endpoint,router as queue_router
)

# ============================================
# Pydantic Models for Request/Response
# ============================================
class LoginRequest(BaseModel):
    agent_id: str
    password: str

class LogoutRequest(BaseModel):
    agent_id: str

class HeartbeatRequest(BaseModel):
    agent_id: str

class OriginateCallRequest(BaseModel):
    agent_id: str
    phone_number: str
    caller_id: Optional[str] = None
    gateway: Optional[str] = "czentrix"

class CallActionRequest(BaseModel):
    call_uuid: str
    action: str  # 'hangup', 'hold', 'unhold', 'transfer'

# ============================================
# Lifespan context manager
# ============================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    app_logger.info("🚀 Server starting up...")
    
    # Start FreeSWITCH monitor
    app.fs_monitor = FreeSWITCHAgentMonitor()
    app.fs_monitor.start()
    app_logger.info("✅ FreeSWITCH monitor started")
    
    yield
    
    # Shutdown
    app_logger.info("🛑 Server shutting down...")
    if hasattr(app, 'fs_monitor'):
        app.fs_monitor.stop()
        app_logger.info("✅ FreeSWITCH monitor stopped")

# Create FastAPI app
app = FastAPI(title="Call Center API", version="2.0.0", lifespan=lifespan)

# ============================================
# CORS Configuration
# ============================================
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

app.include_router(queue_router)  

# ============================================
# Middleware
# ============================================
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = datetime.now()
    response = await call_next(request)
    duration = (datetime.now() - start).total_seconds()
    app_logger.info(f"{request.method} {request.url.path} -> {response.status_code} ({duration:.3f}s)")
    return response

# ============================================
# Exception Handler
# ============================================
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

# ============================================
# Agent API Endpoints
# ============================================
@app.post("/api/auth/login")
async def agent_login(login: LoginRequest):
    """Agent login endpoint"""
    return await agent_login_endpoint(login)

@app.post("/api/auth/logout/manual")
async def agent_logout(logout: LogoutRequest):
    """Agent manual logout"""
    return await agent_logout_endpoint(logout.agent_id)

@app.post("/api/agent/heartbeat")
async def agent_heartbeat(request: Request):
    """Agent heartbeat endpoint"""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token")
    
    token = auth_header.split(" ")[1]
    return await agent_heartbeat_endpoint(token)

@app.websocket("/ws/agent/{agent_id}")
async def websocket_agent(websocket: WebSocket, agent_id: str):
    """WebSocket endpoint for individual agents"""
    await agent_websocket_endpoint(websocket, agent_id)

# ============================================
# Admin Dashboard API Endpoints
# ============================================
@app.get("/api/dashboard/stats")
async def dashboard_stats():
    """Get main dashboard statistics"""
    return await get_dashboard_stats()

@app.get("/api/dashboard/chart")
async def dashboard_chart(days: int = 7):
    """Get chart data for dashboard"""
    return await get_chart_data(days)

@app.get("/api/agents/top")
async def top_agents(limit: int = 5):
    """Get top performing agents"""
    return await get_top_agents(limit)

@app.get("/api/calls/recent")
async def recent_calls(
    limit: int = 50, 
    status: Optional[str] = None, 
    agent_id: Optional[str] = None
):
    """Get recent calls with filters"""
    return await get_recent_calls(limit, status, agent_id)

@app.get("/api/queue/status")
async def queue_status():
    """Get real-time queue status"""
    return await get_queue_status()

@app.get("/api/agents/{agent_id}")
async def agent_details(agent_id: str):
    """Get detailed agent information"""
    return await get_agent_details(agent_id)

@app.get("/api/agents/online")
async def online_agents():
    """Get list of online agents"""
    return await get_online_agents()

@app.get("/api/agent/performance/{agent_id}")
async def agent_performance(agent_id: str, days: int = 7):
    """Get agent performance metrics"""
    performance = get_agent_performance(agent_id, days)
    if not performance:
        raise HTTPException(status_code=404, detail="Agent not found")
    return performance

@app.websocket("/ws/admin/{admin_id}")
async def websocket_admin(websocket: WebSocket, admin_id: str):
    """WebSocket endpoint for admin dashboard"""
    await admin_websocket_endpoint(websocket, admin_id)

# ============================================
# Health Check Endpoint
# ============================================
@app.get("/api/health")
async def health_check():
    """System health check"""
    db_status = "connected"
    try:
        db_session = get_db_session()
        db_session.execute("SELECT 1")
        db_session.close()
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
        },
        "environment": ENVIRONMENT
    }

# ============================================
# Debug Endpoints (Development Only)
# ============================================
if ENVIRONMENT == "development":
    @app.get("/api/debug/check-registration/{agent_id}")
    async def debug_check_registration(agent_id: str):
        """Debug endpoint to test registration check"""
        result = check_softphone_registration(agent_id)
        return {
            "agent_id": agent_id,
            "is_registered": result,
            "timestamp": datetime.now().isoformat(),
            "environment": ENVIRONMENT
        }
    
    @app.get("/api/debug/agent-info/{agent_id}")
    async def debug_agent_info(agent_id: str):
        """Debug endpoint to get agent info"""
        agent = get_agent_info(agent_id)
        return {
            "agent_id": agent_id,
            "agent_info": agent,
            "timestamp": datetime.now().isoformat()
        }

# ============================================
# Call Origination API Endpoints
# ============================================

@app.post("/api/calls/originate")
async def originate_call(request: OriginateCallRequest):
    """
    Originate a call from agent to external number
    """
    from agent import originate_call_direct, originate_with_bridge
    
    # Verify agent is registered
    is_registered = check_softphone_registration(request.agent_id)
    if not is_registered:
        raise HTTPException(
            status_code=400,
            detail="Agent softphone is not registered. Please ensure your softphone is connected."
        )
    
    # Initiate the call
    result = originate_call_direct(
        agent_id=request.agent_id,
        phone_number=request.phone_number,
        caller_id=request.caller_id
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Call failed"))
    
    return result


@app.post("/api/calls/originate/bridge")
async def originate_bridge_call(request: OriginateCallRequest):
    """
    Originate a bridged call between agent and external number
    """
    from agent import originate_with_bridge
    
    # Verify agent is registered
    is_registered = check_softphone_registration(request.agent_id)
    if not is_registered:
        raise HTTPException(
            status_code=400,
            detail="Agent softphone is not registered. Please ensure your softphone is connected."
        )
    
    # Initiate the call
    result = originate_with_bridge(
        agent_id=request.agent_id,
        phone_number=request.phone_number,
        caller_id=request.caller_id,
        gateway=request.gateway
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Call failed"))
    
    return result


@app.get("/api/calls/status/{call_uuid}")
async def get_call_status(call_uuid: str):
    """
    Get status of a specific call
    """
    from agent import check_call_status
    
    result = check_call_status(call_uuid)
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Failed to get call status"))
    
    return result


@app.post("/api/calls/hangup/{call_uuid}")
async def hangup_call_endpoint(call_uuid: str):
    """
    Hangup a specific call
    """
    from agent import hangup_call
    
    result = hangup_call(call_uuid)
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Failed to hangup call"))
    
    return result


@app.post("/api/calls/transfer")
async def transfer_call(call_uuid: str, destination: str):
    """
    Transfer a call to another destination
    """
    try:
        import ESL
        
        conn = ESL.ESLconnection("127.0.0.1", FS_PORT, FS_PASSWORD)
        
        if not conn or not conn.connected():
            raise HTTPException(status_code=500, detail="ESL connection failed")
        
        # Transfer the call
        response = conn.api("uuid_transfer", f"{call_uuid} {destination}")
        
        return {
            "success": True,
            "message": f"Call {call_uuid} transferred to {destination}",
            "call_uuid": call_uuid,
            "destination": destination
        }
        
    except Exception as e:
        log_error("main", e, {"function": "transfer_call"})
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/calls/playback/{call_uuid}")
async def play_audio_to_call(call_uuid: str, audio_file: str):
    """
    Play audio file to an active call
    """
    try:
        import ESL
        
        conn = ESL.ESLconnection("127.0.0.1", FS_PORT, FS_PASSWORD)
        
        if not conn or not conn.connected():
            raise HTTPException(status_code=500, detail="ESL connection failed")
        
        # Play audio to the call
        response = conn.api("uuid_playback", f"{call_uuid} {audio_file}")
        
        return {
            "success": True,
            "message": f"Playing {audio_file} to call {call_uuid}",
            "call_uuid": call_uuid,
            "audio_file": audio_file
        }
        
    except Exception as e:
        log_error("main", e, {"function": "play_audio_to_call"})
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/calls/active/{agent_id}")
async def get_active_calls(agent_id: str):
    """
    Get active calls for an agent
    """
    try:
        import ESL
        
        conn = ESL.ESLconnection("127.0.0.1", FS_PORT, FS_PASSWORD)
        
        if not conn or not conn.connected():
            raise HTTPException(status_code=500, detail="ESL connection failed")
        
        # Show all channels
        response = conn.api("show", "channels")
        
        return {
            "success": True,
            "agent_id": agent_id,
            "channels": response.getHeader("Reply-Text") if response else "No active calls"
        }
        
    except Exception as e:
        log_error("main", e, {"function": "get_active_calls"})
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Main Entry Point
# ============================================
if __name__ == "__main__":
    print("\n" + "="*60)
    print("="*60)
    print(f"Server: http://0.0.0.0:8000")
    print(f"Environment: {ENVIRONMENT}")
    print(f"Redis: {'✅ Available' if REDIS_AVAILABLE else '❌ Not available'}")
    print(f"API Documentation: http://0.0.0.0:8000/docs")
    print(f"Logs: /tmp/fs_logs/")
    print("="*60 + "\n")
    
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=ENVIRONMENT == "development")
