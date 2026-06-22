import { useEffect, useRef } from 'react';
import api from '../services/api';

const SoftphoneMonitor = ({ agent, token, onLogout, children }) => {
  const logoutTimerRef = useRef(null);
  const warningShownRef = useRef(false);
  const intervalRef = useRef(null);

  const getHeartbeatDelay = () => {
    const delay = localStorage.getItem('softphone_heartbeat');
    return delay ? parseInt(delay, 10) * 1000 : 30000;
  };

  const removeWarningBanner = () => {
    const banner = document.getElementById('softphone-warning');
    if (banner) banner.remove();
  };

  const clearLogoutTimer = () => {
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
    warningShownRef.current = false;
    removeWarningBanner();
  };

  const showWarning = () => {
    if (warningShownRef.current) return;
    warningShownRef.current = true;
    const banner = document.createElement('div');
    banner.id = 'softphone-warning';
    banner.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #f97316;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-weight: bold;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      font-family: sans-serif;
    `;
    banner.innerHTML = `⚠️ Softphone disconnected – logging out in ${getHeartbeatDelay() / 1000} seconds...`;
    document.body.appendChild(banner);
  };

  const performLogout = () => {
    clearLogoutTimer();
    if (intervalRef.current) clearInterval(intervalRef.current);
    localStorage.clear();
    if (onLogout) onLogout();
    window.location.href = '/';
  };

  useEffect(() => {
    if (!agent || !token) return;

    const checkHeartbeat = async () => {
      try {
        await api.post('/agent/heartbeat', {}, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (logoutTimerRef.current) {
          clearLogoutTimer();
          console.log('✅ Softphone reconnected – logout cancelled');
        }
      } catch (error) {
        if (error.response?.status === 401) {
          if (!logoutTimerRef.current) {
            showWarning();
            logoutTimerRef.current = setTimeout(() => {
              performLogout();
            }, getHeartbeatDelay());
          }
        } else {
          console.warn('Heartbeat error (non-401):', error.message);
        }
      }
    };

    checkHeartbeat();
    intervalRef.current = setInterval(checkHeartbeat, 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearLogoutTimer();
    };
  }, [agent, token]);

  return children;
};

export default SoftphoneMonitor;
