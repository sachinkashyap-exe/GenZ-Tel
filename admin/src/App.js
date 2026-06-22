import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import DashboardView from './components/DashboardView';
import QueueView from './components/QueueView';
import AgentsView from './components/AgentsView';

function App() {
  const [activeTab, setActiveTab] = useState('Queue'); // Default to Queue to see the design
  const [theme, setTheme] = useState('dark');

  const mainWrapper = {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    backgroundColor: '#060b13', // THE DEEP DARK BACKGROUND
  };

  const contentArea = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    backgroundColor: '#060b13', // Ensure this matches exactly
  };

  return (
    <div style={mainWrapper}>
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        theme={theme} 
        setTheme={setTheme} 
      />

      <div style={contentArea}>
        {/* Dynamic Content Loading */}
        <div style={{ padding: '0px' }}> {/* Removed padding here so components control their own space */}
          {activeTab === 'Dashboard' && <DashboardView />}
          {activeTab === 'Queue' && <QueueView />}
          {activeTab === 'Agents' && <AgentsView />}

          {activeTab !== 'Dashboard' && activeTab !== 'Queue' && activeTab !== 'Agents' && (
            <div style={{ textAlign: 'center', marginTop: '100px', color: '#475569' }}>
               <h2>Feature Coming Soon</h2>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
