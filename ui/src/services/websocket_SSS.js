// /var/www/html/genZ_tel/ui/src/services/websocket.js

class WebSocketService {
    constructor() {
        this.ws = null;
        this.agentId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
        this.heartbeatInterval = null;
        this.pingInterval = null;

        // NEW: callbacks for softphone status
        this.onSoftphoneDeregisteredCallback = null;
        this.onSoftphoneRegisteredCallback = null;
    }

    connect(agentId, token, onMessage, onDisconnect, onSoftphoneDeregistered, onSoftphoneRegistered) {
        this.agentId = agentId;
        // Store the new callbacks
        this.onSoftphoneDeregisteredCallback = onSoftphoneDeregistered;
        this.onSoftphoneRegisteredCallback = onSoftphoneRegistered;

        const wsUrl = `ws://localhost:8000/ws/agent/${agentId}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            this.pingInterval = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send('ping');
                }
            }, 30000);
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('WebSocket message:', data);

                if (onMessage) onMessage(data);

                // NEW: handle softphone registration events
                if (data.type === 'softphone_unregistered') {
                    if (this.onSoftphoneDeregisteredCallback) this.onSoftphoneDeregisteredCallback(data);
                } else if (data.type === 'softphone_registered') {
                    if (this.onSoftphoneRegisteredCallback) this.onSoftphoneRegisteredCallback(data);
                }

                if (data.type === 'force_logout') {
                    this.disconnect();
                    if (onDisconnect) onDisconnect(data);
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.reconnect();
        };
    }

    reconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts && this.agentId) {
            this.reconnectAttempts++;
            console.log(`Reconnecting attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            setTimeout(() => {
                if (this.agentId) {
                    // Pass the stored callbacks again on reconnect
                    this.connect(this.agentId, null, this.onMessageCallback, this.onDisconnectCallback,
                                 this.onSoftphoneDeregisteredCallback, this.onSoftphoneRegisteredCallback);
                }
            }, this.reconnectDelay * this.reconnectAttempts);
        }
    }

    disconnect() {
        if (this.pingInterval) clearInterval(this.pingInterval);
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    setCallbacks(onMessage, onDisconnect) {
        this.onMessageCallback = onMessage;
        this.onDisconnectCallback = onDisconnect;
    }
}

export default new WebSocketService();
