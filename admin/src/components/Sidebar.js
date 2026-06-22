import React, { useState } from 'react';
import {
  LayoutDashboard, Users, UserSquare2, Users2, Phone, PhoneCall,
  BarChart3, ShieldCheck, Settings, Box, Bell, FileSearch, Headphones,
  Menu, X
} from 'lucide-react';

const Sidebar = ({ activeTab, setActiveTab }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const menuItems = [
    { name: 'Dashboard', icon: <LayoutDashboard size={18}/> },
    { name: 'Users', icon: <Users size={18}/> },
    { name: 'Queue', icon: <PhoneCall size={18}/> },
    { name: 'Agents', icon: <UserSquare2 size={18}/> },
    { name: 'SIP Trunk', icon: <Phone size={18}/> },
    { name: 'Reports', icon: <BarChart3 size={18}/> },
    { name: 'Quality Monitoring', icon: <ShieldCheck size={18}/> },
    { name: 'Settings', icon: <Settings size={18}/> },
    { name: 'API Logs', icon: <FileSearch size={18}/> },
  ];

  const sidebarStyle = {
    width: isCollapsed ? '80px' : '260px',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    position: 'sticky',
    top: 0,
    borderRight: '1px solid #1e293b',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    transition: 'width 0.2s ease',
    overflowX: 'hidden',
  };

  const logoStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: isCollapsed ? 'center' : 'space-between',
    padding: isCollapsed ? '24px 12px 32px 12px' : '24px 20px 32px 20px',
    fontSize: '18px',
    fontWeight: 'bold',
    borderBottom: '1px solid #1e293b',
    marginBottom: '16px',
    gap: '10px',
  };

  const logoTextStyle = {
    display: isCollapsed ? 'none' : 'block',
    lineHeight: 1.2,
  };

  const hamburgerStyle = {
    background: 'transparent',
    border: 'none',
    color: '#cbd5e1',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
  };

  const navLabelStyle = {
    fontSize: '10px',
    letterSpacing: '0.5px',
    color: '#64748b',
    padding: isCollapsed ? '0 12px 8px 12px' : '0 20px 8px 20px',
    fontWeight: '600',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const navItemStyle = (isActive) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: isCollapsed ? 'center' : 'flex-start',
    gap: '12px',
    padding: isCollapsed ? '8px 0' : '8px 20px',
    margin: '2px 12px',
    borderRadius: '8px',
    cursor: 'pointer',
    backgroundColor: isActive ? '#3b82f6' : 'transparent',
    color: isActive ? 'white' : '#cbd5e1',
    transition: 'all 0.2s',
    fontSize: '13px',
    fontWeight: isActive ? '500' : '400',
  });

  const navTextStyle = {
    display: isCollapsed ? 'none' : 'inline',
  };

  const userCardStyle = {
    marginTop: 'auto',
    padding: isCollapsed ? '20px 0' : '20px',
    borderTop: '1px solid #1e293b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: isCollapsed ? 'center' : 'flex-start',
    gap: '12px',
  };

  const userInfoStyle = {
    display: isCollapsed ? 'none' : 'block',
  };

  const avatarStyle = {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    backgroundColor: '#3b82f6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: '14px',
    color: 'white',
    flexShrink: 0,
  };

  const footerStyle = {
    padding: isCollapsed ? '12px 0' : '12px 20px',
    fontSize: '10px',
    color: '#475569',
    textAlign: 'center',
    borderTop: '1px solid #1e293b',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={sidebarStyle}>
      <div style={logoStyle}>
        <div style={logoTextStyle}>
          genZ Telephony
          <span style={{ fontSize: '10px', opacity: 0.7, display: 'block' }}>adminUI</span>
        </div>
        <button onClick={() => setIsCollapsed(!isCollapsed)} style={hamburgerStyle}>
          {isCollapsed ? <Menu size={18} /> : <X size={18} />}
        </button>
      </div>

      <div style={navLabelStyle}>MAIN MENU</div>
      {menuItems.slice(0, 1).map((item) => (
        <div
          key={item.name}
          style={navItemStyle(activeTab === item.name)}
          onClick={() => setActiveTab(item.name)}
        >
          {item.icon}
          <span style={navTextStyle}>{item.name}</span>
        </div>
      ))}

      <div style={navLabelStyle}>MANAGEMENT</div>
      {menuItems.slice(2, 5).map((item) => (
        <div
          key={item.name}
          style={navItemStyle(activeTab === item.name)}
          onClick={() => setActiveTab(item.name)}
        >
          {item.icon}
          <span style={navTextStyle}>{item.name}</span>
        </div>
      ))}

      <div style={navLabelStyle}>MIS</div>
      {menuItems.slice(5, 7).map((item) => (
        <div
          key={item.name}
          style={navItemStyle(activeTab === item.name)}
          onClick={() => setActiveTab(item.name)}
        >
          {item.icon}
          <span style={navTextStyle}>{item.name}</span>
        </div>
      ))}

      <div style={navLabelStyle}>SYSTEM</div>
      {menuItems.slice(7).map((item) => (
        <div
          key={item.name}
          style={navItemStyle(activeTab === item.name)}
          onClick={() => setActiveTab(item.name)}
        >
          {item.icon}
          <span style={navTextStyle}>{item.name}</span>
        </div>
      ))}

      <div style={userCardStyle}>
        <div style={avatarStyle}>AA</div>
        <div style={userInfoStyle}>
          <div style={{ fontSize: '13px', fontWeight: '500' }}>HR & Sachin</div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>GenZ Tel</div>
        </div>
      </div>

      <div style={footerStyle}>genZ Telephony v2.1</div>
    </div>
  );
};

export default Sidebar;
