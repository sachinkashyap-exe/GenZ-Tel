import { useState } from 'react';
import api from '../services/api';

export default function Sidebar({ 
  activeTab, setActiveTab, 
  mode, setMode, 
  agent, onLogout,
  theme, setTheme 
}) {
  const [showProfile, setShowProfile] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    
    setLoggingOut(true);
    try {
      // Try token-based logout first
      const token = localStorage.getItem('token');
      if (token) {
        await api.post('/auth/logout');
      } else {
        // Fallback to manual logout
        await api.post('/auth/logout/manual', { agent_id: agent.agent_id });
      }
    } catch (error) {
      console.error('Logout error:', error);
      // If token logout fails, try manual
      try {
        await api.post('/auth/logout/manual', { agent_id: agent.agent_id });
      } catch (err) {
        console.error('Manual logout also failed:', err);
      }
    } finally {
      // Clear local storage regardless of API success
      localStorage.removeItem('token');
      localStorage.removeItem('agent');
      localStorage.removeItem('login_time');
      
      // Call parent logout handler
      if (onLogout) onLogout();
      
      // Force reload to clear state
      window.location.href = '/';
    }
  };

  const menuItems = [
    { id: 'cti', label: 'CTI Dialer', icon: '📞' },
    { id: 'recent', label: 'Recent Calls', icon: '🕒' },
    { id: 'insights', label: 'Insights', icon: '📊' },
    { id: 'dashboard', label: 'Dashboard', icon: '📈' },
    { id: 'contacts', label: 'Saved Contacts', icon: '📇' }
  ];

  const isDark = theme === 'dark';

  const styles = {
    sidebar: {
      width: '260px',
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      display: 'flex',
      flexDirection: 'column',
      borderRight: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      position: 'relative',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    profileSection: {
      padding: '20px 16px',
      borderBottom: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      position: 'relative',
    },
    profile: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      cursor: 'pointer',
      padding: '6px 8px',
      borderRadius: '8px',
      transition: 'background 0.2s',
    },
    avatar: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      backgroundColor: '#3b82f6',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: '500',
      fontSize: '14px',
      color: 'white',
    },
    profileInfo: {
      flex: 1,
    },
    profileName: {
      fontWeight: '500',
      color: isDark ? '#f1f5f9' : '#1e293b',
      fontSize: '13px',
      lineHeight: '1.4',
    },
    profileId: {
      fontSize: '11px',
      color: isDark ? '#94a3b8' : '#64748b',
      lineHeight: '1.3',
    },
    dropdownIcon: {
      fontSize: '10px',
      color: isDark ? '#94a3b8' : '#64748b',
    },
    dropdownMenu: {
      position: 'absolute',
      top: '70px',
      left: '16px',
      right: '16px',
      backgroundColor: isDark ? '#334155' : '#f1f5f9',
      borderRadius: '8px',
      padding: '6px',
      zIndex: 100,
      boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
    },
    dropdownItem: {
      padding: '6px 10px',
      color: isDark ? '#e2e8f0' : '#475569',
      fontSize: '11px',
      borderRadius: '4px',
    },
    dropdownDivider: {
      height: '1px',
      backgroundColor: isDark ? '#475569' : '#cbd5e1',
      margin: '6px 0',
    },
    logoutButton: {
      width: '100%',
      padding: '6px 10px',
      backgroundColor: '#dc2626',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: '500',
    },
    logoutButtonDisabled: {
      width: '100%',
      padding: '6px 10px',
      backgroundColor: '#ef4444',
      color: '#fecaca',
      border: 'none',
      borderRadius: '6px',
      fontSize: '11px',
      fontWeight: '500',
      cursor: 'not-allowed',
    },
    navSection: {
      padding: '20px 16px',
      flex: 1,
    },
    navLabel: {
      fontSize: '10px',
      letterSpacing: '0.5px',
      color: isDark ? '#64748b' : '#94a3b8',
      marginBottom: '10px',
      fontWeight: '600',
    },
    navItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      width: '100%',
      padding: '8px 10px',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '400',
      transition: 'all 0.2s',
      marginBottom: '2px',
      color: isDark ? '#cbd5e1' : '#475569',
    },
    navItemActive: {
      backgroundColor: '#3b82f6',
      color: 'white',
    },
    navIcon: {
      fontSize: '14px',
    },
    navText: {
      fontSize: '12px',
    },
    modeSection: {
      padding: '0 16px 20px',
    },
    modeToggle: {
      display: 'flex',
      gap: '6px',
      backgroundColor: isDark ? '#0f172a' : '#f1f5f9',
      padding: '3px',
      borderRadius: '6px',
    },
    modeButton: {
      flex: 1,
      padding: '6px',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: '500',
      color: isDark ? '#94a3b8' : '#64748b',
    },
    modeButtonActive: {
      backgroundColor: '#3b82f6',
      color: 'white',
    },
    themeSection: {
      padding: '16px',
      borderTop: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
    },
    themeButton: {
      width: '100%',
      padding: '8px',
      backgroundColor: isDark ? '#334155' : '#e2e8f0',
      border: 'none',
      borderRadius: '6px',
      color: isDark ? '#e2e8f0' : '#475569',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '500',
    },
    footer: {
      padding: '16px',
      fontSize: '10px',
      color: isDark ? '#475569' : '#94a3b8',
      textAlign: 'center',
      borderTop: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
    },
  };

  return (
    <div style={styles.sidebar}>
      {/* Profile Section */}
      <div style={styles.profileSection}>
        <div style={styles.profile} onClick={() => setShowProfile(!showProfile)}>
          <div style={styles.avatar}>
            {agent.full_name?.charAt(0) || 'A'}
          </div>
          <div style={styles.profileInfo}>
            <div style={styles.profileName}>{agent.full_name || 'Agent'}</div>
            <div style={styles.profileId}>ID: {agent.agent_id}</div>
          </div>
          <div style={styles.dropdownIcon}>▼</div>
        </div>
        
        {showProfile && (
          <div style={styles.dropdownMenu}>
            <div style={styles.dropdownItem}>Ext: {agent.extension}</div>
            <div style={styles.dropdownItem}>Role: {agent.role || 'Agent'}</div>
            <div style={styles.dropdownItem}>Status: Available</div>
            <div style={styles.dropdownDivider}></div>
            <button 
              onClick={handleLogout} 
              disabled={loggingOut}
              style={loggingOut ? styles.logoutButtonDisabled : styles.logoutButton}
            >
              {loggingOut ? 'Logging out...' : 'Logout'}
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div style={styles.navSection}>
        <div style={styles.navLabel}>NAVIGATION</div>
        {menuItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            style={{
              ...styles.navItem,
              ...(activeTab === item.id ? styles.navItemActive : {})
            }}
          >
            <span style={styles.navIcon}>{item.icon}</span>
            <span style={styles.navText}>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Routing Mode */}
      {activeTab === 'cti' && (
        <div style={styles.modeSection}>
          <div style={styles.navLabel}>ROUTING MODE</div>
          <div style={styles.modeToggle}>
            <button
              onClick={() => setMode('auto')}
              style={{
                ...styles.modeButton,
                ...(mode === 'auto' ? styles.modeButtonActive : {})
              }}
            >
              Auto
            </button>
            <button
              onClick={() => setMode('manual')}
              style={{
                ...styles.modeButton,
                ...(mode === 'manual' ? styles.modeButtonActive : {})
              }}
            >
              Manual
            </button>
          </div>
        </div>
      )}

      {/* Theme Toggle */}
      <div style={styles.themeSection}>
        <button onClick={() => setTheme(isDark ? 'light' : 'dark')} style={styles.themeButton}>
          {isDark ? '☀️ Light Mode' : '🌙 Dark Mode'}
        </button>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        CTI Enterprise v4.0
      </div>
    </div>
  );
}
