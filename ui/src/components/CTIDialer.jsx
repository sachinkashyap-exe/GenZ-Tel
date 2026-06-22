import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import websocketService from '../services/websocket';

const CALL_STATE = {
  IDLE:      'idle',
  DIALING:   'dialing',
  RINGING:   'ringing',
  CONNECTED: 'connected',
  ENDED:     'ended',
  FAILED:    'failed',
};

function formatDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── inject styles (unchanged, keep your existing styles) ─────────────────
const STYLE_ID = 'cti-dialer-styles';
if (!document.getElementById(STYLE_ID)) {
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Sora:wght@300;400;500;600&display=swap');
    @keyframes cti-pulse-ring {
      0%   { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
      70%  { transform: scale(1);    box-shadow: 0 0 0 16px rgba(16,185,129,0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16,185,129,0); }
    }
    @keyframes cti-dot-bounce {
      0%, 80%, 100% { transform: scale(0); opacity: 0.4; }
      40%            { transform: scale(1); opacity: 1; }
    }
    @keyframes cti-slide-up {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes cti-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes cti-shake {
      0%,100% { transform: translateX(0); }
      20%     { transform: translateX(-6px); }
      40%     { transform: translateX(6px); }
      60%     { transform: translateX(-4px); }
      80%     { transform: translateX(4px); }
    }
    .cti-dial-btn:hover  { filter: brightness(1.15); transform: scale(1.06); }
    .cti-dial-btn:active { filter: brightness(0.9);  transform: scale(0.97); }
    .cti-action-btn:hover  { filter: brightness(1.12); }
    .cti-action-btn:active { filter: brightness(0.88); transform: scale(0.96); }
    .cti-hangup-btn:hover  { background: #dc2626 !important; }
    .cti-mute-active   { background: #f59e0b !important; color: #000 !important; }
    .cti-hold-active   { background: #6366f1 !important; }
  `;
  document.head.appendChild(el);
}

export default function CTIDialer({ mode, agent, theme = 'dark', campaignId = 'default' }) {
  const [number, setNumber] = useState('');
  const [callState, setCallState] = useState(CALL_STATE.IDLE);
  const [statusText, setStatusText] = useState('');
  const [activeCallUuid, setActiveCallUuid] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [crmVisible, setCrmVisible] = useState(false);
  const [crmSaved, setCrmSaved] = useState(false);
  const [crmFormData, setCrmFormData] = useState({ notes: '', outcome: 'Interested', follow_up_date: '' });
  const [shake, setShake] = useState(false);

  const timerRef = useRef(null);
  const callUuidRef = useRef(null);
  const pollingRef = useRef(null);
  const fallbackTimerRef = useRef(null);

  const isIdle = callState === CALL_STATE.IDLE;
  const isDialing = callState === CALL_STATE.DIALING || callState === CALL_STATE.RINGING;
  const isConnected = callState === CALL_STATE.CONNECTED;
  const showDialpad = isIdle && !crmVisible;
  const showActive = isDialing || isConnected;

  const startTimer = useCallback(() => {
    setCallDuration(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  // ── Polling call status (every 2 seconds) ────────────────────────────────
  const startPolling = useCallback((uuid) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const currentUuid = callUuidRef.current;
      if (!currentUuid) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        return;
      }
      try {
        const res = await api.get(`/calls/status/${currentUuid}`);
        const status = res.data.status;
        console.log(`[Polling] Call ${currentUuid} status: ${status}`);

        if (status === 'connected' && callState !== CALL_STATE.CONNECTED) {
          setCallState(CALL_STATE.CONNECTED);
          setStatusText('Connected');
          startTimer();
          if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        } else if (status === 'ended' && (callState === CALL_STATE.DIALING || callState === CALL_STATE.RINGING || callState === CALL_STATE.CONNECTED)) {
          stopTimer();
          setCallState(CALL_STATE.ENDED);
          setStatusText('Call ended');
          setCrmVisible(true);
          setActiveCallUuid(null);
          callUuidRef.current = null;
          if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      } catch (err) {
        console.warn('Polling error:', err);
        // If we get 404, call is gone
        if (err.response?.status === 404 && (callState === CALL_STATE.DIALING || callState === CALL_STATE.RINGING)) {
          stopTimer();
          setCallState(CALL_STATE.ENDED);
          setStatusText('Call ended');
          setCrmVisible(true);
          setActiveCallUuid(null);
          callUuidRef.current = null;
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    }, 2000);
  }, [callState, startTimer, stopTimer]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
  }, []);

  // ── WebSocket listener (optional) ────────────────────────────────────────
  useEffect(() => {
    if (!agent) return;
    const handleWs = (data) => {
      console.log('[CTIDialer] WS event:', data);
      const eventUuid = data.call_uuid;
      if (callUuidRef.current && eventUuid && eventUuid !== callUuidRef.current) return;
      if (data.type === 'call:connected') {
        setCallState(CALL_STATE.CONNECTED);
        setStatusText('Connected');
        startTimer();
        stopPolling();
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      } else if (data.type === 'call:ended') {
        stopTimer();
        setCallState(CALL_STATE.ENDED);
        setStatusText('Call ended');
        setCrmVisible(true);
        setActiveCallUuid(null);
        callUuidRef.current = null;
        stopPolling();
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      }
    };
    websocketService.addMessageListener(handleWs);
    return () => {
      websocketService.removeMessageListener(handleWs);
      stopTimer();
      stopPolling();
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    };
  }, [agent, startTimer, stopTimer, stopPolling]);

  // ─── Fallback: if after 8 seconds we are still not connected, assume connected ───
  const startFallbackTimer = useCallback((uuid) => {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = setTimeout(() => {
      if (callUuidRef.current === uuid && callState !== CALL_STATE.CONNECTED && callState !== CALL_STATE.ENDED) {
        console.log('[CTIDialer] Fallback: assuming call is connected after 8 seconds');
        setCallState(CALL_STATE.CONNECTED);
        setStatusText('Connected');
        startTimer();
        stopPolling();
      }
    }, 8000);
  }, [callState, startTimer, stopPolling]);

  // ── Keyboard dialing ─────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'manual' || !isIdle) return;
    const onKey = (e) => {
      if (/[0-9*#]/.test(e.key)) setNumber(p => p + e.key);
      if (e.key === 'Backspace') { e.preventDefault(); setNumber(p => p.slice(0, -1)); }
      if (e.key === 'Enter') handleCall();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, isIdle, number]);

  // ── Initiate call ────────────────────────────────────────────────────────
  const handleCall = async () => {
    if (!number.trim()) { setShake(true); setTimeout(() => setShake(false), 600); return; }
    setCallState(CALL_STATE.DIALING);
    setStatusText('Calling…');
    setActiveCallUuid(null);
    callUuidRef.current = null;
    setCrmVisible(false);
    setCrmSaved(false);
    setCrmFormData({ notes: '', outcome: 'Interested', follow_up_date: '' });

    try {
      const res = await api.post('/calls/originate', {
        agent_id: agent.agent_id,
        phone_number: number,
        caller_id: number,
      });
      const uuid = res.data.call_uuid;
      if (uuid) {
        setActiveCallUuid(uuid);
        callUuidRef.current = uuid;
        startPolling(uuid);
        startFallbackTimer(uuid);
      } else {
        throw new Error('No UUID returned');
      }
    } catch (err) {
      console.error('Call error:', err);
      const uuid = err.response?.data?.call_uuid;
      if (uuid) {
        setActiveCallUuid(uuid);
        callUuidRef.current = uuid;
        setStatusText('Call initiated (API warning)');
        startPolling(uuid);
        startFallbackTimer(uuid);
      } else {
        setCallState(CALL_STATE.FAILED);
        setStatusText(err.response?.data?.detail || 'Call failed');
        setShake(true);
        setTimeout(() => {
          setCallState(CALL_STATE.IDLE);
          setStatusText('');
          setShake(false);
        }, 3000);
      }
    }
  };

  const handleHangup = async () => {
    const uuid = callUuidRef.current || activeCallUuid;
    if (uuid) {
      try { await api.post(`/calls/hangup/${uuid}`); } catch (e) { console.error(e); }
    }
    stopTimer();
    setCallState(CALL_STATE.ENDED);
    setStatusText('Call ended');
    setCrmVisible(true);
    setActiveCallUuid(null);
    callUuidRef.current = null;
    stopPolling();
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
  };

  const handleMute = async () => {
    const uuid = callUuidRef.current || activeCallUuid;
    if (!uuid || !isConnected) return;
    try { await api.post(`/calls/${isMuted ? 'unmute' : 'mute'}/${uuid}`); } catch (e) { console.error(e); }
    setIsMuted(p => !p);
  };

  const handleHold = async () => {
    const uuid = callUuidRef.current || activeCallUuid;
    if (!uuid || !isConnected) return;
    try { await api.post(`/calls/${isOnHold ? 'unhold' : 'hold'}/${uuid}`); } catch (e) { console.error(e); }
    setIsOnHold(p => !p);
  };

  const handleSaveCRM = async () => {
    const uuid = callUuidRef.current || activeCallUuid;
    try {
      await api.post('/crm/save', {
        agent_id: agent.agent_id,
        call_uuid: uuid,
        customer_number: number,
        campaign_id: campaignId,
        form_data: crmFormData,
      });
      setCrmSaved(true);
      setTimeout(() => {
        setCrmVisible(false);
        setCrmSaved(false);
        setCallState(CALL_STATE.IDLE);
        setStatusText('');
        setNumber('');
        setCallDuration(0);
      }, 1500);
    } catch (err) {
      console.error('CRM save error:', err);
    }
  };

  const handleSkipCRM = () => {
    setCrmVisible(false);
    setCallState(CALL_STATE.IDLE);
    setStatusText('');
    setNumber('');
    setCallDuration(0);
  };

  const isDark = theme === 'dark';
  const c = palette(isDark);

  if (mode === 'auto') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <div style={{ background: c.card, borderRadius: 16, padding: '40px 32px', textAlign: 'center', maxWidth: 380, boxShadow: c.shadow, fontFamily: 'Sora, sans-serif' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>📞</div>
          <h2 style={{ color: c.text, fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Inbound — Auto-routing</h2>
          <p style={{ color: c.sub, fontSize: 13, marginBottom: 24 }}>You will be connected automatically when a call arrives.</p>
          <Dots />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', fontFamily: 'Sora, sans-serif' }}>
      <div style={{ background: c.card, borderRadius: 16, padding: '24px 20px', width: 360, boxShadow: c.shadow, animation: 'cti-fade-in 0.25s ease' }}>
        {showDialpad && (
          <div style={{ animation: 'cti-slide-up 0.22s ease' }}>
            <div style={{ background: c.surface, borderRadius: 10, padding: '14px 16px', textAlign: 'center', marginBottom: 16, fontFamily: 'JetBrains Mono, monospace', fontSize: number ? 22 : 15, fontWeight: number ? 600 : 400, color: number ? c.text : c.placeholder, letterSpacing: number ? 2 : 0, animation: shake ? 'cti-shake 0.5s ease' : 'none', minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', wordBreak: 'break-all' }}>
              {number || 'Enter number…'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
              {['1','2','3','4','5','6','7','8','9','*','0','#'].map(d => (
                <button key={d} className="cti-dial-btn" onClick={() => setNumber(p => p + d)} style={{ background: c.btn, color: c.text, border: 'none', borderRadius: 10, padding: '14px 0', fontSize: 18, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'JetBrains Mono, monospace' }}>{d}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button className="cti-action-btn" onClick={() => setNumber('')} style={btnStyle(c.secondary, c.subText)}>Clear</button>
              <button className="cti-action-btn" onClick={() => setNumber(p => p.slice(0,-1))} style={btnStyle('#854d0e', '#fef3c7')}>⌫</button>
              <button className="cti-action-btn" onClick={handleCall} style={{ ...btnStyle('#059669','white'), flex: 2, fontSize: 15, fontWeight: 600 }}>📞 Call</button>
            </div>
            {statusText && <div style={{ textAlign: 'center', fontSize: 12, color: c.accent, padding: '6px 0' }}>{statusText}</div>}
          </div>
        )}

        {showActive && (
          <div style={{ animation: 'cti-slide-up 0.22s ease' }}>
            <div style={{ textAlign: 'center', marginBottom: 20, padding: '18px 12px', background: c.surface, borderRadius: 12 }}>
              <div style={{ fontSize: 11, color: c.sub, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>{isConnected ? 'In Call' : 'Calling'}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 26, fontWeight: 700, color: c.text, letterSpacing: 2 }}>{number}</div>
              {isConnected ? (
                <div style={{ marginTop: 8, fontSize: 20, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color: '#10b981', animation: 'cti-pulse-ring 2s ease infinite', display: 'inline-block' }}>{formatDuration(callDuration)}</div>
              ) : (
                <div style={{ marginTop: 10 }}><Dots /></div>
              )}
            </div>
            <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 12, color: isConnected ? '#10b981' : c.sub, fontWeight: 500 }}>
              {isConnected ? (isOnHold ? '⏸ On Hold' : isMuted ? '🔇 Muted' : '● Live') : statusText}
            </div>
            {isConnected && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button className={`cti-action-btn${isMuted ? ' cti-mute-active' : ''}`} onClick={handleMute} style={{ ...btnStyle(isMuted ? '#f59e0b' : c.btn, isMuted ? '#000' : c.text), flex:1, fontSize:13 }}>{isMuted ? '🔇 Unmute' : '🎙 Mute'}</button>
                <button className={`cti-action-btn${isOnHold ? ' cti-hold-active' : ''}`} onClick={handleHold} style={{ ...btnStyle(isOnHold ? '#6366f1' : c.btn, 'white'), flex:1, fontSize:13 }}>{isOnHold ? '▶ Resume' : '⏸ Hold'}</button>
              </div>
            )}
            <button className="cti-hangup-btn cti-action-btn" onClick={handleHangup} style={{ width: '100%', background: '#ef4444', color: 'white', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer', transition: 'background 0.2s', letterSpacing: 0.5 }}>📵 Hang Up</button>
          </div>
        )}

        {crmVisible && (
          <div style={{ animation: 'cti-slide-up 0.25s ease' }}>
            <div style={{ textAlign: 'center', marginBottom: 16, padding: '12px', background: c.surface, borderRadius: 10 }}>
              <div style={{ fontSize: 11, color: c.sub, letterSpacing: 1.5, textTransform: 'uppercase' }}>Call Ended</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 700, color: c.text, marginTop: 4 }}>{number}</div>
              <div style={{ fontSize: 12, color: '#10b981', marginTop: 4 }}>Duration: {formatDuration(callDuration)}</div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: c.sub, letterSpacing: 1, textTransform: 'uppercase' }}>Notes</label>
              <textarea rows={3} value={crmFormData.notes} onChange={e => setCrmFormData(p => ({...p, notes: e.target.value}))} placeholder="Call notes…" style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.surface, color: c.text, fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'Sora, sans-serif' }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: c.sub, letterSpacing: 1, textTransform: 'uppercase' }}>Outcome</label>
              <select value={crmFormData.outcome} onChange={e => setCrmFormData(p => ({...p, outcome: e.target.value}))} style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.surface, color: c.text, fontSize: 13, boxSizing: 'border-box' }}>
                {['Interested','Not Interested','Call Back Later','Wrong Number','Answered','Voicemail'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: c.sub, letterSpacing: 1, textTransform: 'uppercase' }}>Follow-up Date</label>
              <input type="date" value={crmFormData.follow_up_date} onChange={e => setCrmFormData(p => ({...p, follow_up_date: e.target.value}))} style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.surface, color: c.text, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSkipCRM} style={btnStyle(c.secondary, c.subText)}>Skip</button>
              <button onClick={handleSaveCRM} style={{ ...btnStyle(crmSaved ? '#059669' : '#3b82f6', 'white'), flex: 2, fontWeight: 600, fontSize: 14 }}>{crmSaved ? '✓ Saved!' : '💾 Save & Close'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 4 }}>
      {[0,1,2].map(i => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6', display: 'block', animation: `cti-dot-bounce 1.4s ease-in-out ${i*0.16}s infinite` }} />
      ))}
    </div>
  );
}

function btnStyle(bg, color) {
  return { flex: 1, background: bg, color, border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'Sora, sans-serif' };
}

function palette(isDark) {
  return isDark ? {
    card: '#1e293b', surface: '#0f172a', btn: '#334155', secondary: '#374151',
    border: '#334155', text: '#f1f5f9', sub: '#94a3b8', subText: '#cbd5e1',
    placeholder: '#475569', accent: '#34d399', shadow: '0 8px 32px rgba(0,0,0,0.4)',
  } : {
    card: '#ffffff', surface: '#f8fafc', btn: '#e2e8f0', secondary: '#e5e7eb',
    border: '#d1d5db', text: '#0f172a', sub: '#64748b', subText: '#374151',
    placeholder: '#94a3b8', accent: '#059669', shadow: '0 8px 32px rgba(0,0,0,0.1)',
  };
}
