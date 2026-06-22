import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import DashboardView from './components/DashboardView';
import QueueView from './components/QueueView';
import AgentsView from './components/AgentsView';
// These would be your future "less files"
// import AgentsView from './components/AgentsView';
// import CampaignsView from './components/CampaignsView';

function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');

  const mainWrapper = {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    backgroundColor: '#f8fafc',
  };

  const contentArea = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  };

  return (
    <div style={mainWrapper}>
      {/* Sidebar - Pass activeTab to highlight the button */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div style={contentArea}>

        {/* Dynamic Content Loading */}
        <div style={{ padding: '24px' }}>
          {activeTab === 'Dashboard' && <DashboardView />}
          {activeTab === 'Queue' && <QueueView />}
	  {activeTab === 'Agents' && <AgentsView />}
          
          {activeTab !== 'Dashboard' && activeTab !== 'Agents' && (
            <div style={{ textAlign: 'center', marginTop: '50px', color: '#94a3b8' }}>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
