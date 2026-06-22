import { useState } from 'react';
import Sidebar from './Sidebar';
import CTIDialer from './CTIDialer';
import RecentCalls from './RecentCalls';
import Insights from './Insights';
import Dashboard from './Dashboard';
import SavedContacts from './SavedContacts';
import SoftphoneMonitor from './SoftphoneMonitor';
import InboundCallPopup from './InboundCallPopup';   // 👈 NEW

export default function Layout({ agent, onLogout }) {
  const [activeTab, setActiveTab] = useState('cti');
  const [mode, setMode] = useState('auto');
  const [theme, setTheme] = useState('dark');

  const token = localStorage.getItem('token');

  const handleLogout = () => {
    if (onLogout) onLogout();
  };

  // ── Inbound call callbacks ────────────────────────────────────────────────
  const handleCallAnswered = (call) => {
    console.log('Inbound call answered:', call);
    // Optionally switch to CTI tab automatically
    setActiveTab('cti');
  };

  const handleCallRejected = (call) => {
    console.log('Inbound call rejected/missed:', call);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'cti':
        return <CTIDialer mode={mode} agent={agent} theme={theme} />;
      case 'recent':
        return <RecentCalls agent={agent} theme={theme} />;
      case 'insights':
        return <Insights agent={agent} theme={theme} />;
      case 'dashboard':
        return <Dashboard agent={agent} theme={theme} />;
      case 'contacts':
        return <SavedContacts agent={agent} theme={theme} />;
      default:
        return <CTIDialer mode={mode} agent={agent} theme={theme} />;
    }
  };

  const isDark = theme === 'dark';

  return (
    <SoftphoneMonitor agent={agent} token={token} onLogout={handleLogout}>

      {/* ── Global inbound popup — floats above everything ── */}
      <InboundCallPopup
        agent={agent}
        onCallAnswered={handleCallAnswered}
        onCallRejected={handleCallRejected}
      />

      <div style={{
        display: 'flex',
        height: '100vh',
        backgroundColor: isDark ? '#0f172a' : '#f8fafc',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          mode={mode}
          setMode={setMode}
          agent={agent}
          onLogout={handleLogout}
          theme={theme}
          setTheme={setTheme}
        />
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px',
        }}>
          {renderContent()}
        </div>
      </div>

    </SoftphoneMonitor>
  );
}

