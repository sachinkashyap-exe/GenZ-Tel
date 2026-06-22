import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import websocketService from '../services/websocket';

// ── Inject styles (unchanged – keep your existing styles) ────────────────
const STYLE_ID = 'inbound-popup-styles';
if (!document.getElementById(STYLE_ID)) {
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600&family=Sora:wght@300;400;500;600&display=swap');

    @keyframes ib-slide-down {
      from { opacity: 0; transform: translateY(-32px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }
    @keyframes ib-ring-pulse {
      0%,100% { box-shadow: 0 0 0 0   rgba(16,185,129,0.6); }
      50%      { box-shadow: 0 0 0 18px rgba(16,185,129,0); }
    }
    @keyframes ib-reject-pulse {
      0%,100% { box-shadow: 0 0 0 0   rgba(239,68,68,0.6); }
      50%      { box-shadow: 0 0 0 18px rgba(239,68,68,0); }
    }
    @keyframes ib-shake {
      0%,100% { transform: translateX(0) rotate(0deg); }
      15%      { transform: translateX(-4px) rotate(-8deg); }
      30%      { transform: translateX(4px)  rotate(8deg); }
      45%      { transform: translateX(-3px) rotate(-5deg); }
      60%      { transform: translateX(3px)  rotate(5deg); }
      75%      { transform: translateX(-2px) rotate(-3deg); }
    }
    @keyframes ib-progress {
      from { width: 100%; }
      to   { width: 0%; }
    }
    @keyframes ib-dot-bounce {
      0%,80%,100% { transform: scale(0.6); opacity: 0.4; }
      40%          { transform: scale(1);   opacity: 1; }
    }
    .ib-answer-btn:hover  { filter: brightness(1.15) !important; transform: scale(1.08) !important; }
    .ib-answer-btn:active { filter: brightness(0.9)  !important; transform: scale(0.96) !important; }
    .ib-reject-btn:hover  { filter: brightness(1.15) !important; transform: scale(1.08) !important; }
    .ib-reject-btn:active { filter: brightness(0.9)  !important; transform: scale(0.96) !important; }
  `;
  document.head.appendChild(el);
}

const AUTO_ANSWER_SECONDS = 30;
const RING_AUDIO_URL = null;

export default function InboundCallPopup({ agent, onCallAnswered, onCallRejected }) {
  const [inboundCall, setInboundCall] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [activeTimer, setActiveTimer] = useState(0);
  const [shakePhone, setShakePhone] = useState(false);

  const timerRef = useRef(null);
  const activeRef = useRef(null);
  const audioRef = useRef(null);
  const callRef = useRef(null);

  useEffect(() => { callRef.current = inboundCall; }, [inboundCall]);

  useEffect(() => {
    if (RING_AUDIO_URL) {
      audioRef.current = new Audio(RING_AUDIO_URL);
      audioRef.current.loop = true;
    }
    return () => { if (audioRef.current) audioRef.current.pause(); };
  }, []);

  const startRing = useCallback(() => {
    if (audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play().catch(() => {}); }
    const shakeLoop = setInterval(() => {
      setShakePhone(true);
      setTimeout(() => setShakePhone(false), 600);
    }, 2000);
    return shakeLoop;
  }, []);

  const stopRing = useCallback((shakeLoop) => {
    if (audioRef.current) audioRef.current.pause();
    if (shakeLoop) clearInterval(shakeLoop);
  }, []);

  useEffect(() => {
    if (!agent || !agent.agent_id) return;

    // ✅ Ensure WebSocket service knows the agent ID before adding listener
    websocketService.setAgentId(agent.agent_id);

    let shakeLoop = null;

    const handleWsMessage = (data) => {
      console.log('[InboundCallPopup] WS event:', data);

      switch (data.type) {
        case 'inbound:ringing':
        case 'call:incoming': {
          const call = {
            call_uuid:   data.call_uuid,
            caller_id:   data.caller_id   || 'Unknown',
            caller_name: data.caller_name || '',
            queue:       data.queue        || '',
            direction:   'inbound',
          };
          setInboundCall(call);
          setPhase('ringing');
          setElapsed(0);
          setActiveTimer(0);

          clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            setElapsed(p => {
              const next = p + 1;
              if (AUTO_ANSWER_SECONDS > 0 && next >= AUTO_ANSWER_SECONDS) {
                handleReject(call.call_uuid, true);
              }
              return next;
            });
          }, 1000);

          shakeLoop = startRing();
          break;
        }

        case 'inbound:answered':
        case 'call:connected': {
          if (phase === 'ringing' || phase === 'answering') {
            clearInterval(timerRef.current);
            stopRing(shakeLoop);
            setPhase('active');
            setActiveTimer(0);
            activeRef.current = setInterval(() => setActiveTimer(p => p + 1), 1000);
            if (onCallAnswered) onCallAnswered(callRef.current);
          }
          break;
        }

        case 'inbound:ended':
        case 'call:ended': {
          clearInterval(timerRef.current);
          clearInterval(activeRef.current);
          stopRing(shakeLoop);
          if (phase !== 'idle') {
            setPhase('missed');
            setTimeout(() => {
              setPhase('idle');
              setInboundCall(null);
              if (onCallRejected) onCallRejected(callRef.current);
            }, 2500);
          }
          break;
        }

        default: break;
      }
    };

    websocketService.addMessageListener(handleWsMessage);
    return () => {
      websocketService.removeMessageListener(handleWsMessage);
      clearInterval(timerRef.current);
      clearInterval(activeRef.current);
      stopRing(shakeLoop);
    };
  }, [agent, onCallAnswered, onCallRejected, startRing, stopRing, phase]);

  const handleAnswer = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    clearInterval(timerRef.current);
    stopRing(null);
    setPhase('answering');
    try {
      await api.post(`/calls/answer/${call.call_uuid}`, { agent_id: agent.agent_id });
    } catch (err) {
      console.error('Answer error:', err);
      setPhase('active');
      setActiveTimer(0);
      activeRef.current = setInterval(() => setActiveTimer(p => p + 1), 1000);
      if (onCallAnswered) onCallAnswered(call);
    }
  }, [agent, onCallAnswered, stopRing]);

  const handleReject = useCallback(async (uuidOverride, isMissed = false) => {
    const call = callRef.current;
    const uuid = uuidOverride || call?.call_uuid;
    clearInterval(timerRef.current);
    clearInterval(activeRef.current);
    stopRing(null);
    setPhase(isMissed ? 'missed' : 'idle');
    setTimeout(() => { setPhase('idle'); setInboundCall(null); }, isMissed ? 2500 : 1800);
    if (uuid) { try { await api.post(`/calls/hangup/${uuid}`); } catch (e) { console.error(e); } }
    if (onCallRejected) onCallRejected(call);
  }, [onCallRejected, stopRing]);

  const handleHangupActive = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    clearInterval(activeRef.current);
    try { await api.post(`/calls/hangup/${call.call_uuid}`); } catch (e) { console.error(e); }
    setPhase('idle');
    setInboundCall(null);
  }, []);

  if (phase === 'idle') return null;

  const progressPct = AUTO_ANSWER_SECONDS > 0
    ? Math.max(0, ((AUTO_ANSWER_SECONDS - elapsed) / AUTO_ANSWER_SECONDS) * 100)
    : 100;

  return (
    <div style={overlayStyle}>
      <div style={popupStyle}>
        {inboundCall?.queue && <div style={queueBadgeStyle}>📋 {inboundCall.queue}</div>}
        {(phase === 'ringing' || phase === 'answering') && (
          <>
            <div style={{ fontSize: 52, textAlign: 'center', marginBottom: 4, animation: shakePhone ? 'ib-shake 0.6s ease' : 'none', display: 'inline-block', width: '100%' }}>📲</div>
            <div style={labelStyle}>Incoming Call</div>
            <div style={callerStyle}>
              {inboundCall?.caller_name ? (
                <>
                  <div>{inboundCall.caller_name}</div>
                  <div style={{ fontSize: 14, color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>{inboundCall.caller_id}</div>
                </>
              ) : (
                <div style={{ fontFamily: 'JetBrains Mono, monospace' }}>{inboundCall?.caller_id}</div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, margin: '10px 0 16px' }}>
              {[0,1,2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6', display: 'block', animation: `ib-dot-bounce 1.4s ease-in-out ${i*0.16}s infinite` }} />)}
            </div>
            {AUTO_ANSWER_SECONDS > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: elapsed > AUTO_ANSWER_SECONDS * 0.6 ? '#ef4444' : '#10b981', width: `${progressPct}%`, transition: 'width 1s linear, background 0.4s', borderRadius: 2 }} />
                </div>
                <div style={{ textAlign: 'right', fontSize: 10, color: '#64748b', marginTop: 3 }}>Auto-dismiss in {Math.max(0, AUTO_ANSWER_SECONDS - elapsed)}s</div>
              </div>
            )}
            {phase === 'ringing' ? (
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="ib-reject-btn" onClick={() => handleReject()} style={{ flex: 1, background: '#ef4444', color: 'white', border: 'none', borderRadius: 50, padding: '14px 0', fontSize: 22, cursor: 'pointer', transition: 'all 0.2s', animation: 'ib-reject-pulse 1.5s ease infinite' }}>📵</button>
                <button className="ib-answer-btn" onClick={handleAnswer} style={{ flex: 1, background: '#10b981', color: 'white', border: 'none', borderRadius: 50, padding: '14px 0', fontSize: 22, cursor: 'pointer', transition: 'all 0.2s', animation: 'ib-ring-pulse 1.5s ease infinite' }}>📞</button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#10b981', fontSize: 13, padding: '8px 0' }}>Connecting…</div>
            )}
            <div style={{ textAlign: 'center', fontSize: 11, color: '#475569', marginTop: 10 }}>Ringing {elapsed}s</div>
          </>
        )}
        {phase === 'active' && (
          <>
            <div style={{ fontSize: 44, textAlign: 'center', marginBottom: 6 }}>📞</div>
            <div style={labelStyle}>In Call</div>
            <div style={callerStyle}><div style={{ fontFamily: 'JetBrains Mono, monospace' }}>{inboundCall?.caller_id}</div></div>
            <div style={{ textAlign: 'center', fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#10b981', margin: '10px 0 16px' }}>{formatTime(activeTimer)}</div>
            <button onClick={handleHangupActive} style={{ width: '100%', background: '#ef4444', color: 'white', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer', transition: 'background 0.2s' }}>📵 Hang Up</button>
          </>
        )}
        {phase === 'missed' && (
          <>
            <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 8 }}>📵</div>
            <div style={{ textAlign: 'center', color: '#ef4444', fontWeight: 600, fontSize: 15 }}>Missed Call</div>
            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, marginTop: 4 }}>{inboundCall?.caller_id}</div>
          </>
        )}
      </div>
    </div>
  );
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
  display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 24,
  pointerEvents: 'none',
};
const popupStyle = {
  background: '#1e293b', borderRadius: 16, padding: '24px 20px', width: 300,
  boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
  animation: 'ib-slide-down 0.3s cubic-bezier(0.34,1.56,0.64,1)', pointerEvents: 'all',
  fontFamily: 'Sora, sans-serif',
};
const queueBadgeStyle = { background: '#0f172a', color: '#94a3b8', fontSize: 11, padding: '4px 10px', borderRadius: 20, textAlign: 'center', marginBottom: 14, letterSpacing: 0.5 };
const labelStyle = { textAlign: 'center', fontSize: 12, color: '#64748b', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 };
const callerStyle = { textAlign: 'center', fontSize: 20, fontWeight: 700, color: '#f1f5f9', marginBottom: 4, wordBreak: 'break-all' };
