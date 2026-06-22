from datetime import datetime
from fastapi import APIRouter, HTTPException, Request, WebSocket
from fastapi.response import Response
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import text
from config import (
    app_logger, manager, get_db_session, log_error, REDIS_AVAILABLE, redis_client,
    FS_HOST
)
import hashlib
import ESL
import shutil
import asyncio
from apscheduler.schedulers.background import BackgroundScheduler
from contextlib import asynccontextmanager

# ============================================
# Helper: Callcenter agent status via ESL
# ============================================

def set_callcenter_agent_status(agent_id: str, status: str) -> bool:
    """
    Set FreeSWITCH callcenter agent status.
    status: 'Available' or 'LoggedOut'
    Returns True on success.
    """
    try:
        conn = ESL.ESLconnection("127.0.0.1", 8021, "ClueCon")
        if conn and conn.connected():
            agent_full = f"{agent_id}@{FS_HOST}"
            cmd = f"callcenter_config agent set status {agent_full} {status}"
            res = conn.api(cmd)
            if res and res.getHeader("Reply-Text") and "+OK" in res.getHeader("Reply-Text"):
                app_logger.info(f"Set callcenter agent {agent_full} status -> {status}")
                return True
            else:
                app_logger.warning(f"Failed to set status for {agent_full}: {res}")
        else:
            app_logger.error("ESL connection failed")
    except Exception as e:
        log_error("admin", e, {"function": "set_callcenter_agent_status", "agent_id": agent_id})
    return False

def get_callcenter_agent_status(agent_id: str) -> Optional[str]:
    """Query current callcenter agent status via ESL."""
    try:
        conn = ESL.ESLconnection("127.0.0.1", 8021, "ClueCon")
        if conn and conn.connected():
            agent_full = f"{agent_id}@{FS_HOST}"
            res = conn.api(f"callcenter_config agent list {agent_full}")
            if res and res.getHeader("Reply-Text"):
                # Parse output: lines like "name|...|status|..."
                for line in res.getHeader("Reply-Text").split("\n"):
                    if line.startswith(agent_full):
                        parts = line.split("|")
                        # status is the 6th field (0-index: name, instance, uuid, type, contact, status, state, ...)
                        if len(parts) > 5:
                            return parts[5]
    except Exception as e:
        log_error("admin", e, {"function": "get_callcenter_agent_status"})
    return None

async def sync_all_agent_statuses():
    """
    Sync callcenter agent status based on Redis online_agents set.
    Agents in online_agents -> Available, else LoggedOut.
    """
    if not REDIS_AVAILABLE or not redis_client:
        app_logger.warning("Redis not available, cannot sync agent statuses")
        return

    db = get_db_session()
    try:
        # Get all agent IDs from DB
        agents = db.execute(text("SELECT agent_id FROM agents")).fetchall()
        if not agents:
            return

        # Get online set from Redis
        online_set = redis_client.smembers("online_agents")
        online_agents = {aid.decode() if isinstance(aid, bytes) else aid for aid in online_set}

        for (agent_id,) in agents:
            desired_status = "Available" if agent_id in online_agents else "LoggedOut"
            current_status = get_callcenter_agent_status(agent_id)
            if current_status != desired_status:
                set_callcenter_agent_status(agent_id, desired_status)
    except Exception as e:
        log_error("admin", e, {"function": "sync_all_agent_statuses"})
    finally:
        db.close()

# ============================================
# Background Scheduler for status sync
# ============================================

scheduler = BackgroundScheduler()

@asynccontextmanager
async def lifespan(app):
    # Startup: start scheduler
    scheduler.add_job(lambda: asyncio.run(sync_all_agent_statuses()), 'interval', seconds=10, id='agent_status_sync')
    scheduler.start()
    app_logger.info("Agent status sync scheduler started")
    yield
    # Shutdown: stop scheduler
    scheduler.shutdown()

# ============================================
# Dashboard Functions (unchanged)
# ============================================

async def get_dashboard_stats():
    db = get_db_session()
    try:
        result = db.execute(text("""
            SELECT
                COUNT(*) as total_calls,
                SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as answered_calls,
                SUM(CASE WHEN status = 'Missed' THEN 1 ELSE 0 END) as missed_calls,
                AVG(CASE WHEN status = 'Completed' AND duration > 0 THEN duration ELSE NULL END) as avg_handle_time,
                COUNT(DISTINCT agent_id) as active_agents
            FROM call_logs
            WHERE start_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        """))
        current = result.first()
        if current is None:
            current = type('obj', (object,), {'total_calls': 0, 'answered_calls': 0, 'missed_calls': 0, 'avg_handle_time': None, 'active_agents': 0})()

        prev_result = db.execute(text("""
            SELECT
                COUNT(*) as total_calls,
                SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as answered_calls,
                SUM(CASE WHEN status = 'Missed' THEN 1 ELSE 0 END) as missed_calls,
                AVG(CASE WHEN status = 'Completed' AND duration > 0 THEN duration ELSE NULL END) as avg_handle_time
            FROM call_logs
            WHERE start_time BETWEEN DATE_SUB(NOW(), INTERVAL 14 DAY) AND DATE_SUB(NOW(), INTERVAL 7 DAY)
        """))
        prev = prev_result.first()
        if prev is None:
            prev = type('obj', (object,), {'total_calls': 0, 'answered_calls': 0, 'missed_calls': 0, 'avg_handle_time': None})()

        csat_result = db.execute(text("SELECT AVG(score) as avg_csat FROM csat_scores WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"))
        csat = csat_result.first()
        avg_csat = csat.avg_csat if csat and csat.avg_csat is not None else 4.6

        agent_status = db.execute(text("""
            SELECT
                SUM(CASE WHEN status = 'Available' THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN status = 'OnCall' THEN 1 ELSE 0 END) as on_call,
                SUM(CASE WHEN status = 'Break' THEN 1 ELSE 0 END) as on_break,
                SUM(CASE WHEN status = 'LoggedOut' THEN 1 ELSE 0 END) as logged_out
            FROM agents
        """))
        agents = agent_status.first()
        if agents is None:
            agents = type('obj', (object,), {'available': 0, 'on_call': 0, 'on_break': 0, 'logged_out': 0})()

        def safe_pct(curr, prev):
            if prev and prev > 0:
                return round((curr - prev) / prev * 100, 1)
            return 0.0

        total_change = safe_pct(current.total_calls, prev.total_calls)
        answered_change = safe_pct(current.answered_calls, prev.answered_calls)
        missed_change = safe_pct(current.missed_calls, prev.missed_calls)
        handle_time_change = safe_pct(current.avg_handle_time or 0, prev.avg_handle_time or 0)

        avg_seconds = current.avg_handle_time or 0
        avg_handle_time_str = f"{int(avg_seconds // 60):02d}:{int(avg_seconds % 60):02d}"

        return {
            "total_calls": current.total_calls or 0,
            "total_calls_change": total_change,
            "answered_calls": current.answered_calls or 0,
            "answered_calls_change": answered_change,
            "missed_calls": current.missed_calls or 0,
            "missed_calls_change": missed_change,
            "avg_handle_time": avg_handle_time_str,
            "avg_handle_time_change": handle_time_change,
            "csat_score": round(avg_csat, 1),
            "csat_score_change": 3.2,
            "active_agents": current.active_agents or 0,
            "available_agents": agents.available or 0,
            "agents_on_call": agents.on_call or 0,
            "agents_on_break": agents.on_break or 0,
            "logged_out_agents": agents.logged_out or 0
        }
    except Exception as e:
        log_error("admin", e, {"function": "get_dashboard_stats"})
        raise HTTPException(500, "Failed to fetch dashboard stats")
    finally:
        db.close()

async def get_chart_data(days: int = 7):
    db = get_db_session()
    try:
        result = db.execute(text("""
            SELECT DATE(start_time) as date, COUNT(*) as total_calls,
                   SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as answered_calls,
                   SUM(CASE WHEN status = 'Missed' THEN 1 ELSE 0 END) as missed_calls
            FROM call_logs
            WHERE start_time >= DATE_SUB(NOW(), INTERVAL :days DAY)
            GROUP BY DATE(start_time) ORDER BY DATE(start_time)
        """), {"days": days})
        rows = result.fetchall()
        return {
            "dates": [row.date.strftime('%b %d') for row in rows],
            "total": [row.total_calls for row in rows],
            "answered": [row.answered_calls for row in rows],
            "missed": [row.missed_calls for row in rows]
        }
    except Exception as e:
        log_error("admin", e, {"function": "get_chart_data"})
        raise HTTPException(500, "Failed to fetch chart data")
    finally:
        db.close()

async def get_top_agents(limit: int = 5):
    db = get_db_session()
    try:
        result = db.execute(text("""
            SELECT a.agent_id, a.full_name as name, a.agent_type,
                   COUNT(c.id) as call_count,
                   AVG(CASE WHEN c.status = 'Completed' AND c.duration > 0 THEN c.duration ELSE NULL END) as avg_duration,
                   AVG(csat.score) as avg_csat
            FROM agents a
            LEFT JOIN call_logs c ON a.agent_id = c.agent_id AND c.status = 'Completed' AND c.start_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            LEFT JOIN csat_scores csat ON c.call_uuid = csat.call_uuid
            GROUP BY a.agent_id ORDER BY call_count DESC LIMIT :limit
        """), {"limit": limit})
        agents = result.fetchall()
        return [{
            "agent_id": a.agent_id, "name": a.name, "tier": a.agent_type or 'agent', "team": "General",
            "call_count": a.call_count or 0,
            "avg_duration": f"{int(a.avg_duration // 60) if a.avg_duration else 0:02d}:{int(a.avg_duration % 60) if a.avg_duration else 0:02d}",
            "csat_score": round(a.avg_csat or 0, 1)
        } for a in agents]
    except Exception as e:
        log_error("admin", e, {"function": "get_top_agents"})
        raise HTTPException(500, "Failed to fetch top agents")
    finally:
        db.close()

async def get_recent_calls(limit: int = 50, status: Optional[str] = None, agent_id: Optional[str] = None):
    db = get_db_session()
    try:
        query = text("""
            SELECT c.call_uuid as call_id, c.direction as call_type, c.customer_number as phone_number, c.destination,
                   a.full_name as agent_name, a.agent_type as agent_tier, c.duration, c.status, c.start_time, csat.score as csat_score
            FROM call_logs c
            LEFT JOIN agents a ON c.agent_id = a.agent_id
            LEFT JOIN csat_scores csat ON c.call_uuid = csat.call_uuid
            WHERE 1=1 {status_filter} {agent_filter}
            ORDER BY c.start_time DESC LIMIT :limit
        """)
        sql = str(query)
        params = {"limit": limit}
        if status:
            sql = sql.replace("{status_filter}", "AND c.status = :status")
            params["status"] = status
        else:
            sql = sql.replace("{status_filter}", "")
        if agent_id:
            sql = sql.replace("{agent_filter}", "AND c.agent_id = :agent_id")
            params["agent_id"] = agent_id
        else:
            sql = sql.replace("{agent_filter}", "")
        result = db.execute(text(sql), params)
        calls = result.fetchall()
        return [{
            "call_id": c.call_id[:12] + "...", "call_type": c.call_type or 'Inbound',
            "phone_number": c.phone_number or c.destination, "agent_name": c.agent_name or 'Unassigned',
            "agent_tier": c.agent_tier or '-', "agent_team": "General",
            "duration": f"{c.duration // 60:02d}:{c.duration % 60:02d}" if c.duration and c.duration > 0 else "-",
            "status": c.status, "timestamp": c.start_time.strftime("%b %d, %Y %I:%M %p") if c.start_time else "Unknown",
            "csat_score": c.csat_score or '-'
        } for c in calls]
    except Exception as e:
        log_error("admin", e, {"function": "get_recent_calls"})
        raise HTTPException(500, "Failed to fetch recent calls")
    finally:
        db.close()

async def get_queue_status():
    db = get_db_session()
    try:
        result = db.execute(text("""
            SELECT q.name as queue_name, q.strategy, q.timeout,
                   COUNT(DISTINCT a.agent_id) as total_agents,
                   SUM(CASE WHEN a.status = 'Available' THEN 1 ELSE 0 END) as available_agents,
                   SUM(CASE WHEN a.status = 'OnCall' THEN 1 ELSE 0 END) as busy_agents,
                   SUM(CASE WHEN a.status = 'Break' THEN 1 ELSE 0 END) as break_agents,
                   COALESCE(rqm.waiting_calls, 0) as waiting_calls,
                   COALESCE(rqm.avg_wait_time, 0) as avg_wait_time,
                   COALESCE(rqm.service_level, 0) as service_level
            FROM queues q
            LEFT JOIN campaign_agents ca ON q.campaign_id = ca.campaign_id
            LEFT JOIN agents a ON ca.agent_id = a.agent_id
            LEFT JOIN (SELECT queue_name, waiting_calls, avg_wait_time, service_level FROM realtime_queue_metrics WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) ORDER BY timestamp DESC) rqm ON q.name = rqm.queue_name
            GROUP BY q.id
        """))
        queues = result.fetchall()
        return [{
            "queue_name": q.queue_name, "strategy": q.strategy,
            "total_agents": q.total_agents or 0, "available_agents": q.available_agents or 0,
            "busy_agents": q.busy_agents or 0, "break_agents": q.break_agents or 0,
            "waiting_calls": q.waiting_calls or 0, "avg_wait_time": q.avg_wait_time or 0,
            "service_level": round(q.service_level or 0, 1), "timeout": q.timeout
        } for q in queues]
    except Exception as e:
        log_error("admin", e, {"function": "get_queue_status"})
        return []
    finally:
        db.close()

async def get_agent_details(agent_id: str):
    db = get_db_session()
    try:
        agent_row = db.execute(text("""
            SELECT a.*, COUNT(c.id) as total_calls,
                   AVG(CASE WHEN c.status = 'Completed' AND c.duration > 0 THEN c.duration ELSE NULL END) as avg_handle_time,
                   AVG(csat.score) as avg_csat
            FROM agents a
            LEFT JOIN call_logs c ON a.agent_id = c.agent_id
            LEFT JOIN csat_scores csat ON c.call_uuid = csat.call_uuid
            WHERE a.agent_id = :aid GROUP BY a.agent_id
        """), {"aid": agent_id}).first()
        if not agent_row:
            raise HTTPException(404, "Agent not found")
        calls = db.execute(text("SELECT call_uuid, direction, destination, duration, status, start_time FROM call_logs WHERE agent_id = :aid ORDER BY start_time DESC LIMIT 10"), {"aid": agent_id}).fetchall()
        return {
            "agent_id": agent_row.agent_id, "name": agent_row.full_name, "extension": agent_row.extension,
            "role": "agent",
            "status": agent_row.status,
            "tier": agent_row.agent_type or "agent",
            "team": "General",
            "total_calls": agent_row.total_calls or 0,
            "avg_handle_time": f"{int(agent_row.avg_handle_time // 60) if agent_row.avg_handle_time else 0:02d}:{int(agent_row.avg_handle_time % 60) if agent_row.avg_handle_time else 0:02d}",
            "avg_csat": round(agent_row.avg_csat or 0, 1),
            "recent_calls": [{
                "call_id": c.call_uuid[:12] + "...", "call_type": c.direction, "destination": c.destination,
                "duration": f"{c.duration // 60:02d}:{c.duration % 60:02d}" if c.duration else "-",
                "status": c.status, "timestamp": c.start_time.strftime("%b %d, %Y %I:%M %p")
            } for c in calls]
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error("admin", e, {"function": "get_agent_details", "agent_id": agent_id})
        raise HTTPException(500, "Failed to fetch agent details")
    finally:
        db.close()

async def get_online_agents():
    if REDIS_AVAILABLE and redis_client:
        try:
            online = list(redis_client.smembers("online_agents"))
            details = []
            for aid in online:
                aid_str = aid.decode() if isinstance(aid, bytes) else aid
                d = redis_client.hgetall(f"agent:{aid_str}")
                details.append({"agent_id": aid_str, "full_name": d.get(b"full_name", aid_str).decode() if isinstance(d.get(b"full_name"), bytes) else d.get("full_name", aid_str), "status": d.get(b"status", "Unknown").decode() if isinstance(d.get(b"status"), bytes) else d.get("status", "Unknown"), "login_time": d.get(b"login_time")})
            return {"success": True, "online_agents": [a.decode() if isinstance(a, bytes) else a for a in online], "count": len(online), "agent_details": details}
        except Exception as e:
            log_error("admin", e, {"function": "get_online_agents"})
            return {"success": False, "error": "Redis error", "online_agents": [], "count": 0}
    else:
        return {"success": False, "error": "Redis not available", "online_agents": [], "count": 0}

async def admin_websocket_endpoint(websocket: WebSocket, admin_id: str):
    try:
        await manager.connect_admin(websocket, admin_id)
        await websocket.send_json({"type": "connected", "message": "Admin dashboard connected", "timestamp": datetime.now().isoformat()})
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except Exception as e:
        log_error("admin", e, {"function": "admin_websocket", "admin_id": admin_id})
    finally:
        manager.disconnect(admin_id)

# ============================================
# FreeSWITCH Helpers (Modified)
# ============================================

def generate_callcenter_xml():
    db = get_db_session()
    try:
        queues = db.execute(text("SELECT name, queue_strategy, queue_timeout, dialer_wrapup_time FROM campaigns")).fetchall()
        agents = db.execute(text("SELECT agent_id, extension, status FROM agents")).fetchall()
        tiers = db.execute(text("""
            SELECT c.name as queue_name, a.agent_id
            FROM campaign_agents ca JOIN campaigns c ON ca.campaign_id = c.id JOIN agents a ON ca.agent_id = a.agent_id
        """)).fetchall()
        lines = ['<configuration name="callcenter.conf" description="CallCenter">', '  <settings>', '  </settings>', '  <queues>']
        for q in queues:
            lines.append(f'    <queue name="{q.name}@{FS_HOST}">')
            lines.append(f'      <param name="strategy" value="{q.queue_strategy or "ring_all"}"/>')
            lines.append(f'      <param name="timeout" value="{q.queue_timeout}"/>')
            lines.append(f'      <param name="wrap-up-time" value="{q.dialer_wrapup_time}"/>')
            lines.append('    </queue>')
        lines.append('  </queues>  <agents>')
        # Always include all agents from DB, using user/{extension} contact
        for a in agents:
            lines.append(f'    <agent name="{a.agent_id}@{FS_HOST}">')
            lines.append('      <param name="type" value="callback"/>')
            # Use user/extension – sip_router will always resolve it
            lines.append(f'      <param name="contact" value="user/{a.extension}"/>')
            # Start with LoggedOut; background sync will flip to Available if online
            lines.append('      <param name="status" value="LoggedOut"/>')
            lines.append('      <param name="max-no-answer" value="2"/>')
            lines.append('      <param name="wrap-up-time" value="10"/>')
            lines.append('    </agent>')
        lines.append('  </agents>')
        if tiers:
            lines.append('  <tiers>')
            for t in tiers:
                lines.append(f'    <tier queue="{t.queue_name}@{FS_HOST}" agent="{t.agent_id}@{FS_HOST}" level="1"/>')
            lines.append('  </tiers>')
        lines.append('</configuration>')
        xml = "\n".join(lines)
        path = "/usr/local/freeswitch/conf/autoload_configs/callcenter.conf.xml"
        shutil.copyfile(path, path + ".bak")
        with open(path, "w") as f:
            f.write(xml)
        app_logger.info("Generated callcenter.conf.xml with all agents (initial status LoggedOut)")
        return True
    except Exception as e:
        app_logger.error(f"XML generation failed: {e}")
        return False
    finally:
        db.close()

def reload_freeswitch():
    try:
        conn = ESL.ESLconnection("127.0.0.1", 8021, "ClueCon")
        if conn and conn.connected():
            conn.api("reloadxml")
            conn.api("reload", "mod_callcenter")
            app_logger.info("FreeSWITCH reloaded")
            return True
        return False
    except Exception as e:
        app_logger.error(f"ESL error: {e}")
        return False

# ============================================
# Routers
# ============================================

router = APIRouter(prefix="/admin/queues", tags=["queues"])

class CampaignBase(BaseModel):
    name: str
    campaign_type: str
    dialer_wrapup_time: int
    queue_timeout: int
    csat_feedback_enabled: bool
    campaign_name: Optional[str] = None
    dialplan: Optional[str] = "XML"
    queue_strategy: Optional[str] = "ring_all"
    softphone_heartbeat: int = 30
    webrtc_login: bool = False
    is_active: bool = True

class CampaignCreate(CampaignBase):
    pass

class CampaignUpdate(CampaignBase):
    pass

class CampaignResponse(CampaignBase):
    id: int
    created_at: datetime
    updated_at: datetime

def db_to_campaign(row):
    return {
        "id": row[0], "name": row[1], "campaign_type": row[2], "dialer_wrapup_time": row[3],
        "queue_timeout": row[4], "csat_feedback_enabled": bool(row[5]), "created_at": row[6],
        "updated_at": row[7], "campaign_name": row[8], "dialplan": row[9], "queue_strategy": row[10],
        "softphone_heartbeat": row[11], "webrtc_login": bool(row[12]) if row[12] is not None else False,
        "is_active": bool(row[13]) if len(row) > 13 else True
    }

@router.get("/", response_model=list[CampaignResponse])
async def get_all_campaigns():
    db = get_db_session()
    try:
        rows = db.execute(text("""
            SELECT id, name, campaign_type, dialer_wrapup_time, queue_timeout,
                   csat_feedback_enabled, created_at, updated_at, campaign_name,
                   dialplan, queue_strategy, softphone_heartbeat, webrtc_login, is_active
            FROM campaigns ORDER BY id
        """)).fetchall()
        return [db_to_campaign(r) for r in rows]
    except Exception as e:
        log_error("admin", e, {"function": "get_all_campaigns"})
        raise HTTPException(500, str(e))
    finally:
        db.close()

@router.post("/", response_model=CampaignResponse)
async def create_campaign(campaign: CampaignCreate):
    db = get_db_session()
    try:
        if db.execute(text("SELECT id FROM campaigns WHERE name = :name"), {"name": campaign.name}).first():
            raise HTTPException(400, "Campaign name already exists")
        res = db.execute(text("""
            INSERT INTO campaigns (name, campaign_type, dialer_wrapup_time, queue_timeout,
                csat_feedback_enabled, campaign_name, dialplan, queue_strategy,
                softphone_heartbeat, webrtc_login, is_active)
            VALUES (:name, :type, :wrapup, :timeout, :csat, :cname, :dialplan,
                    :strategy, :heartbeat, :webrtc, :is_active)
        """), {
            "name": campaign.name, "type": campaign.campaign_type, "wrapup": campaign.dialer_wrapup_time,
            "timeout": campaign.queue_timeout, "csat": campaign.csat_feedback_enabled,
            "cname": campaign.campaign_name or campaign.name, "dialplan": campaign.dialplan,
            "strategy": campaign.queue_strategy, "heartbeat": campaign.softphone_heartbeat,
            "webrtc": campaign.webrtc_login, "is_active": campaign.is_active
        })
        db.commit()
        row = db.execute(text("SELECT * FROM campaigns WHERE id = :id"), {"id": res.lastrowid}).first()
        return db_to_campaign(row)
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        log_error("admin", e, {"function": "create_campaign"})
        raise HTTPException(500, str(e))
    finally:
        db.close()

@router.put("/{campaign_id}", response_model=CampaignResponse)
async def update_campaign(campaign_id: int, campaign: CampaignUpdate):
    db = get_db_session()
    try:
        if db.execute(text("SELECT id FROM campaigns WHERE name = :name AND id != :id"), {"name": campaign.name, "id": campaign_id}).first():
            raise HTTPException(400, "Campaign name already exists")
        res = db.execute(text("""
            UPDATE campaigns SET name=:name, campaign_type=:type, dialer_wrapup_time=:wrapup,
                queue_timeout=:timeout, csat_feedback_enabled=:csat, campaign_name=:cname,
                dialplan=:dialplan, queue_strategy=:strategy, softphone_heartbeat=:heartbeat,
                webrtc_login=:webrtc, is_active=:is_active
            WHERE id=:id
        """), {
            "id": campaign_id, "name": campaign.name, "type": campaign.campaign_type,
            "wrapup": campaign.dialer_wrapup_time, "timeout": campaign.queue_timeout,
            "csat": campaign.csat_feedback_enabled, "cname": campaign.campaign_name or campaign.name,
            "dialplan": campaign.dialplan, "strategy": campaign.queue_strategy,
            "heartbeat": campaign.softphone_heartbeat, "webrtc": campaign.webrtc_login,
            "is_active": campaign.is_active
        })
        if res.rowcount == 0:
            raise HTTPException(404, "Campaign not found")
        db.commit()
        row = db.execute(text("SELECT * FROM campaigns WHERE id = :id"), {"id": campaign_id}).first()
        return db_to_campaign(row)
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        log_error("admin", e, {"function": "update_campaign", "campaign_id": campaign_id})
        raise HTTPException(500, str(e))
    finally:
        db.close()

@router.delete("/{campaign_id}")
async def delete_campaign(campaign_id: int):
    db = get_db_session()
    try:
        res = db.execute(text("DELETE FROM campaigns WHERE id = :id"), {"id": campaign_id})
        if res.rowcount == 0:
            raise HTTPException(404, "Campaign not found")
        db.commit()
        return {"message": "Campaign deleted"}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        log_error("admin", e, {"function": "delete_campaign", "campaign_id": campaign_id})
        raise HTTPException(500, str(e))
    finally:
        db.close()

class FtpSettings(BaseModel):
    host: str = "ftp.genztel.com"
    username: str = ""
    password: str = ""
    port: int = 21
    remote_path: str = "/"

@router.post("/{campaign_id}/ftp")
async def save_ftp_settings(campaign_id: int, settings: FtpSettings):
    db = get_db_session()
    try:
        camp = db.execute(text("SELECT id FROM campaigns WHERE id = :id"), {"id": campaign_id}).first()
        if not camp:
            raise HTTPException(404, "Campaign not found")
        db.execute(text("""
            INSERT INTO campaign_ftp_settings (campaign_id, host, username, password, port, remote_path)
            VALUES (:cid, :host, :user, :pass, :port, :path)
            ON DUPLICATE KEY UPDATE
                host = VALUES(host), username = VALUES(username), password = VALUES(password),
                port = VALUES(port), remote_path = VALUES(remote_path)
        """), {
            "cid": campaign_id, "host": settings.host, "user": settings.username,
            "pass": settings.password, "port": settings.port, "path": settings.remote_path
        })
        db.commit()
        return {"message": "FTP settings saved successfully"}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        log_error("admin", e, {"function": "save_ftp_settings", "campaign_id": campaign_id})
        raise HTTPException(500, str(e))
    finally:
        db.close()

apply_router = APIRouter(prefix="/admin", tags=["freeswitch"])

@apply_router.post("/apply/freeswitch")
async def apply_freeswitch_config():
    if not generate_callcenter_xml():
        raise HTTPException(500, "Failed to generate callcenter configuration")
    if not reload_freeswitch():
        raise HTTPException(500, "Failed to reload FreeSWITCH via ESL")
    # After reload, immediately sync agent statuses to bring online agents to Available
    await sync_all_agent_statuses()
    return {"message": "FreeSWITCH configuration updated and reloaded successfully"}

sip_router = APIRouter(prefix="/api/sip", tags=["sip"])

@sip_router.post("/directory")
async def sip_directory(request: Request):
    try:
        form = await request.form()
        user = form.get("user")
        domain = form.get("domain", "default")
        if not user:
            return Response(content='<document type="freeswitch/xml"/>', media_type="application/xml")
        db = get_db_session()
        try:
            agent = db.execute(text("SELECT sip_password, full_name FROM agents WHERE extension = :ext"), {"ext": user}).first()
        finally:
            db.close()
        if not agent:
            return Response(content='<document type="freeswitch/xml"/>', media_type="application/xml")
        password = agent.sip_password or ""
        full_name = agent.full_name or f"Agent {user}"
        xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
  <section name="directory">
    <domain name="{domain}">
      <params>
        <param name="dial-string" value="{{presence_id=${{dialed_user}}@${{dialed_diamond}}}}${{sofia_contact(${{dialed_user}}@${{dialed_domain}})}}"/>
      </params>
      <groups>
        <group name="default">
          <users>
            <user id="{user}">
              <params>
                <param name="password" value="{password}"/>
              </params>
              <variables>
                <variable name="user_context" value="default"/>
                <variable name="effective_caller_id_name" value="{full_name}"/>
                <variable name="effective_caller_id_number" value="{user}"/>
              </variables>
            </user>
          </users>
        </group>
      </groups>
    </domain>
  </section>
</document>'''
        return Response(content=xml, media_type="application/xml")
    except Exception as e:
        app_logger.error(f"SIP directory error: {e}", exc_info=True)
        return Response(content='<document type="freeswitch/xml"/>', media_type="application/xml", status_code=500)

agents_router = APIRouter(prefix="/admin/agents", tags=["agents"])

class AgentBase(BaseModel):
    agent_id: str
    agent_identity: str = ""
    full_name: str
    extension: str
    status: str = "LoggedOut"
    sip_password: Optional[str] = None
    agent_type: str = "Normal"
    allow_remote_login: bool = False

class AgentCreate(AgentBase):
    pass

class AgentUpdate(AgentBase):
    pass

@agents_router.get("/")
async def get_agents():
    db = get_db_session()
    try:
        rows = db.execute(text("""
            SELECT agent_id, full_name, extension, status, sip_password,
                   agent_identity, agent_type, allow_remote_login
            FROM agents
        """)).fetchall()
        return [{
            "agent_id": r[0], "full_name": r[1], "extension": r[2],
            "status": r[3], "sip_password": r[4] or "",
            "agent_identity": r[5] or "", "agent_type": r[6] or "Normal",
            "allow_remote_login": bool(r[7])
        } for r in rows]
    except Exception as e:
        log_error("admin", e, {"function": "get_agents"})
        raise HTTPException(500, str(e))
    finally:
        db.close()

@agents_router.post("/")
async def create_agent(agent: AgentCreate):
    db = get_db_session()
    try:
        if db.execute(text("SELECT agent_id FROM agents WHERE agent_id = :aid"), {"aid": agent.agent_id}).first():
            raise HTTPException(400, "Agent ID already exists")
        pwd_hash = hashlib.md5(agent.sip_password.encode()).hexdigest() if agent.sip_password else ""
        db.execute(text("""
            INSERT INTO agents (agent_id, agent_identity, full_name, extension, status,
                                sip_password, password_hash, agent_type, allow_remote_login)
            VALUES (:aid, :identity, :name, :ext, :status, :sip, :hash, :type, :remote)
        """), {
            "aid": agent.agent_id, "identity": agent.agent_identity, "name": agent.full_name,
            "ext": agent.extension, "status": agent.status, "sip": agent.sip_password,
            "hash": pwd_hash, "type": agent.agent_type, "remote": 1 if agent.allow_remote_login else 0
        })
        db.commit()
        # After creating agent, regenerate XML and reload to include new agent
        generate_callcenter_xml()
        reload_freeswitch()
        await sync_all_agent_statuses()
        return {"message": "Agent created"}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        log_error("admin", e, {"function": "create_agent"})
        raise HTTPException(500, str(e))
    finally:
        db.close()

@agents_router.put("/{agent_id}")
async def update_agent(agent_id: str, agent: AgentUpdate):
    db = get_db_session()
    try:
        pwd_hash = hashlib.md5(agent.sip_password.encode()).hexdigest() if agent.sip_password else None
        res = db.execute(text("""
            UPDATE agents SET
                agent_identity = :identity,
                full_name = :name,
                extension = :ext,
                status = :status,
                sip_password = :sip,
                password_hash = COALESCE(:hash, password_hash),
                agent_type = :type,
                allow_remote_login = :remote
            WHERE agent_id = :aid
        """), {
            "aid": agent_id, "identity": agent.agent_identity, "name": agent.full_name,
            "ext": agent.extension, "status": agent.status, "sip": agent.sip_password,
            "hash": pwd_hash, "type": agent.agent_type, "remote": 1 if agent.allow_remote_login else 0
        })
        if res.rowcount == 0:
            raise HTTPException(404, "Agent not found")
        db.commit()
        generate_callcenter_xml()
        reload_freeswitch()
        await sync_all_agent_statuses()
        return {"message": "Agent updated"}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        log_error("admin", e, {"function": "update_agent", "agent_id": agent_id})
        raise HTTPException(500, str(e))
    finally:
        db.close()

@agents_router.delete("/{agent_id}")
async def delete_agent(agent_id: str):
    db = get_db_session()
    try:
        res = db.execute(text("DELETE FROM agents WHERE agent_id = :aid"), {"aid": agent_id})
        if res.rowcount == 0:
            raise HTTPException(404, "Agent not found")
        db.commit()
        generate_callcenter_xml()
        reload_freeswitch()
        await sync_all_agent_statuses()
        return {"message": "Agent deleted"}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        log_error("admin", e, {"function": "delete_agent", "agent_id": agent_id})
        raise HTTPException(500, str(e))
    finally:
        db.close()

@agents_router.get("/{agent_id}/campaigns")
async def get_agent_campaigns(agent_id: str):
    db = get_db_session()
    try:
        rows = db.execute(text("""
            SELECT c.id, c.name, c.campaign_type FROM campaigns c
            JOIN campaign_agents ca ON c.id = ca.campaign_id WHERE ca.agent_id = :aid
        """), {"aid": agent_id}).fetchall()
        return [{"id": r[0], "name": r[1], "campaign_type": r[2]} for r in rows]
    except Exception as e:
        log_error("admin", e, {"function": "get_agent_campaigns", "agent_id": agent_id})
        raise HTTPException(500, str(e))
    finally:
        db.close()

@agents_router.put("/{agent_id}/campaigns")
async def assign_agent_campaigns(agent_id: str, payload: dict):
    campaign_ids = payload.get("campaign_ids", [])
    db = get_db_session()
    try:
        db.execute(text("DELETE FROM campaign_agents WHERE agent_id = :aid"), {"aid": agent_id})
        for cid in campaign_ids:
            db.execute(text("INSERT INTO campaign_agents (campaign_id, agent_id) VALUES (:cid, :aid)"), {"cid": cid, "aid": agent_id})
        db.commit()
        generate_callcenter_xml()
        reload_freeswitch()
        await sync_all_agent_statuses()
        return {"message": "Campaigns assigned", "assigned": campaign_ids}
    except Exception as e:
        db.rollback()
        log_error("admin", e, {"function": "assign_agent_campaigns", "agent_id": agent_id})
        raise HTTPException(500, str(e))
    finally:
        db.close()
