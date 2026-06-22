import { useState, useEffect } from 'react';
import api from '../services/api';

export default function Home({ agent, onLogout }) {
  const [onlineAgents, setOnlineAgents] = useState([]);

  useEffect(() => {
    fetchOnlineAgents();
    const interval = setInterval(fetchOnlineAgents, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchOnlineAgents = async () => {
    try {
      const response = await api.get('/agents/online');
      if (response.data.success) {
        setOnlineAgents(response.data.online_agents);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleLogout = async () => {
    await api.post('/auth/logout/manual', { agent_id: agent.agent_id });
    localStorage.clear();
    onLogout();
  };

  return (
    <div>
      <div style={styles.header}>
        <h2>Welcome, {agent.full_name}</h2>
        <button onClick={handleLogout} style={styles.logoutBtn}>Logout</button>
      </div>
      
      <div style={styles.stats}>
        <div style={styles.card}>
          <h3>Agent ID</h3>
          <p>{agent.agent_id}</p>
        </div>
        <div style={styles.card}>
          <h3>Extension</h3>
          <p>{agent.extension}</p>
        </div>
        <div style={styles.card}>
          <h3>Status</h3>
          <p style={{ color: '#4caf50' }}>{agent.status}</p>
        </div>
      </div>
      
      <div style={styles.onlineSection}>
        <h3>Online Agents ({onlineAgents.length})</h3>
        {onlineAgents.map(id => (
          <div key={id} style={styles.agentCard}>
            Agent {id}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  header: {
    background: '#fff',
    padding: '20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  logoutBtn: {
    background: '#dc3545',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '5px',
    cursor: 'pointer'
  },
  stats: {
    display: 'flex',
    gap: '20px',
    padding: '20px',
    flexWrap: 'wrap'
  },
  card: {
    background: 'white',
    padding: '20px',
    borderRadius: '8px',
    flex: '1',
    textAlign: 'center'
  },
  onlineSection: {
    background: 'white',
    margin: '20px',
    padding: '20px',
    borderRadius: '8px'
  },
  agentCard: {
    background: '#e8f5e9',
    padding: '10px',
    margin: '10px 0',
    borderRadius: '5px'
  }
};
