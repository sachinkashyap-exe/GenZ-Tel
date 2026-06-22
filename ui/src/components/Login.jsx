import { useState } from 'react';
import api from '../services/api';

export default function Login({ onLogin }) {
  const [agentId, setAgentId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const response = await api.post('/auth/login', { 
        agent_id: agentId, 
        password: password 
      });
      
      if (response.data.success) {
        localStorage.setItem('token', response.data.access_token);
        localStorage.setItem('agent', JSON.stringify(response.data.agent));
        
        // Show warning if FreeSWITCH is down
        if (response.data.system_status?.freeswitch === false) {
          console.warn('⚠️ FreeSWITCH is offline - call features unavailable');
        }
        
        onLogin(response.data.agent);
      }
    } catch (err) {
      console.error('Login error:', err);
      
      // Extract specific error messages
      const errorMsg = err.response?.data?.error || 
                      err.response?.data?.detail || 
                      err.message;
      
      // Set user-friendly error messages
      if (errorMsg.includes("Agent ID not found")) {
        setError("❌ Agent ID not found. Please check your agent ID.");
      } else if (errorMsg.includes("Incorrect password")) {
        setError("❌ Incorrect password. Please try again.");
      } else if (errorMsg.includes("Database connection failed")) {
        setError("❌ Database connection error. Please contact support.");
      } else if (errorMsg.includes("Internal server error")) {
        setError("⚠️ Server error. Please try again later.");
      } else if (err.code === 'ERR_NETWORK') {
        setError("❌ Cannot connect to server. Please check if backend is running.");
      } else {
        setError(errorMsg || "Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>📞</div>
        <h2 style={styles.title}>GenZ Tel</h2>
        <p style={styles.subtitle}>Agent Login Portal</p>
        
        {error && (
          <div style={styles.error}>
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Agent ID"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            style={styles.input}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            required
          />
          <button type="submit" disabled={loading} style={loading ? styles.buttonDisabled : styles.button}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    backgroundColor: '#1e293b',
    padding: '40px',
    borderRadius: '16px',
    width: '360px',
    textAlign: 'center',
    boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
  },
  logo: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#f1f5f9',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '14px',
    color: '#94a3b8',
    marginBottom: '24px',
  },
  error: {
    backgroundColor: '#7f1d1d',
    color: '#fecaca',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '13px',
    textAlign: 'left',
    borderLeft: '4px solid #ef4444',
  },
  input: {
    width: '100%',
    padding: '12px',
    marginBottom: '12px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#f1f5f9',
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  button: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  buttonDisabled: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#475569',
    color: '#94a3b8',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'not-allowed',
  },
  demo: {
    marginTop: '20px',
    fontSize: '11px',
    color: '#64748b',
  },
};
