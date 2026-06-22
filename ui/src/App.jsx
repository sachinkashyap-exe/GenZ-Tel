import { useState, useEffect } from 'react';
import Login from './components/Login';
import Layout from './components/Layout';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [agent, setAgent] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedAgent = localStorage.getItem('agent');
    if (token && storedAgent) {
      setIsAuthenticated(true);
      setAgent(JSON.parse(storedAgent));
    }
  }, []);

  const handleLogin = (agentData) => {
    setAgent(agentData);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.clear();
    setIsAuthenticated(false);
    setAgent(null);
  };

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }
  
  return <Layout agent={agent} onLogout={handleLogout} />;
}

export default App;
