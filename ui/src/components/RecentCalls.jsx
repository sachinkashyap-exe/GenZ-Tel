import { useState, useEffect } from 'react';
import api from '../services/api';

export default function RecentCalls({ agent, theme = 'dark' }) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const isDark = theme === 'dark';

  useEffect(() => {
    fetchCalls();
  }, []);

  const fetchCalls = async () => {
    try {
      const res = await api.get('/calls/history');
      setCalls(res.data.calls || [
        { id: 1, number: '+1 234 567 890', duration: '2:34', time: '10:32 AM', type: 'inbound' },
        { id: 2, number: '+1 987 654 321', duration: '5:12', time: 'Yesterday', type: 'outbound' },
        { id: 3, number: '+44 20 7946 0138', duration: '1:05', time: 'Yesterday', type: 'inbound' },
        { id: 4, number: '+91 98765 43210', duration: '0:48', time: 'Apr 12', type: 'outbound' },
      ]);
    } catch (error) {
      console.error('Failed to fetch calls:', error);
    } finally {
      setLoading(false);
    }
  };

  const redial = (number) => {
    alert(`Redialing ${number}...`);
  };

  const styles = {
    container: {
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      borderRadius: '12px',
      padding: '20px',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px',
    },
    title: {
      fontSize: '16px',
      fontWeight: '600',
      color: isDark ? '#f1f5f9' : '#1e293b',
      margin: 0,
    },
    refreshBtn: {
      backgroundColor: isDark ? '#334155' : '#f1f5f9',
      color: isDark ? '#e2e8f0' : '#475569',
      border: 'none',
      padding: '6px 12px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: '500',
    },
    callList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    },
    callItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      padding: '12px',
      borderRadius: '8px',
    },
    callNumber: {
      fontSize: '13px',
      fontWeight: '500',
      color: isDark ? '#f1f5f9' : '#1e293b',
      fontFamily: 'monospace',
    },
    callMeta: {
      fontSize: '10px',
      color: isDark ? '#94a3b8' : '#64748b',
      marginTop: '4px',
      display: 'flex',
      gap: '8px',
    },
    inbound: {
      color: '#3b82f6',
    },
    outbound: {
      color: '#10b981',
    },
    callActions: {
      textAlign: 'right',
    },
    callDuration: {
      fontSize: '12px',
      color: isDark ? '#cbd5e1' : '#475569',
      display: 'block',
      marginBottom: '4px',
    },
    redialBtn: {
      backgroundColor: '#3b82f6',
      color: 'white',
      border: 'none',
      padding: '4px 10px',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '10px',
      fontWeight: '500',
    },
    loading: {
      textAlign: 'center',
      color: isDark ? '#94a3b8' : '#64748b',
      padding: '40px',
    },
    emptyState: {
      textAlign: 'center',
      color: isDark ? '#64748b' : '#94a3b8',
      padding: '40px',
    },
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Recent Calls</h2>
        <button onClick={fetchCalls} style={styles.refreshBtn}>⟳ Refresh</button>
      </div>
      
      {calls.length === 0 ? (
        <div style={styles.emptyState}>No calls yet</div>
      ) : (
        <div style={styles.callList}>
          {calls.map(call => (
            <div key={call.id} style={styles.callItem}>
              <div>
                <div style={styles.callNumber}>{call.number}</div>
                <div style={styles.callMeta}>
                  <span style={call.type === 'inbound' ? styles.inbound : styles.outbound}>
                    {call.type === 'inbound' ? '📞 Inbound' : '📤 Outbound'}
                  </span>
                  <span>• {call.time}</span>
                </div>
              </div>
              <div style={styles.callActions}>
                <div style={styles.callDuration}>{call.duration}</div>
                <button onClick={() => redial(call.number)} style={styles.redialBtn}>Redial</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
