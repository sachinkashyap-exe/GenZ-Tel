// ui/src/services/websocket.js
class WebSocketService {
  constructor() {
    this.socket = null;
    this.listeners = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 3000;
    this.agentId = null; // set after login
  }

  setAgentId(agentId) {
    this.agentId = agentId;
    if (this.socket) this.socket.close();
    this.connect();
  }

  connect() {
    const token = localStorage.getItem('token');
    if (!token || !this.agentId) {
      console.warn('WebSocket: missing token or agentId');
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/agent/${this.agentId}?token=${token}`;
    console.log('WebSocket connecting to:', wsUrl);

    this.socket = new WebSocket(wsUrl);
    this.socket.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
    };
    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.listeners.forEach(listener => {
          try { listener(data); } catch (err) { console.error('listener error:', err); }
        });
      } catch (err) {
        console.error('WebSocket parse error:', err);
      }
    };
    this.socket.onclose = (event) => {
      console.log('WebSocket closed', event.code, event.reason);
      this.scheduleReconnect();
    };
    this.socket.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached, giving up');
      return;
    }
    setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`Reconnecting WebSocket (attempt ${this.reconnectAttempts})...`);
      this.connect();
    }, this.reconnectDelay);
  }

  addMessageListener(callback) {
    if (typeof callback !== 'function') return;
    this.listeners.add(callback);
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.connect();
    }
  }

  removeMessageListener(callback) {
    this.listeners.delete(callback);
    if (this.listeners.size === 0 && this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

export default new WebSocketService();
