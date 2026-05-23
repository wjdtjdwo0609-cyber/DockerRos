// WebSocket client for the OPC UA ↔ WS adapter (see opcua_ws_adapter.py).
// Exposes catalog + live tag state as events + simple write() method.
//
// Events dispatched (CustomEvent):
//   'status'    detail: { connected: bool, reason?: string }
//   'catalog'   detail: [{ name, direction, label }]
//   'snapshot'  detail: { tagName: value }
//   'update'    detail: { tag, value }     fired on every change (incl. snapshot replay)
//   'error'     detail: { message }
//
// Auto-reconnects every RECONNECT_MS on close/error. The socket is plaintext
// ws:// on localhost — no auth; this is a local-dev integration.

const DEFAULT_URL = 'ws://127.0.0.1:9091';
const RECONNECT_MS = 3000;

export class OpcuaClient extends EventTarget {
  constructor(url = DEFAULT_URL) {
    super();
    this.url = url;
    this.ws = null;
    this.catalog = [];            // [{ name, direction, label }]
    this.state = Object.create(null); // { tagName: value }
    this.connected = false;
    this._reconnectTimer = null;
    this._connect();
  }

  _connect() {
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this._scheduleReconnect();
      return;
    }
    this.ws.addEventListener('open', () => {
      this.connected = true;
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: true } }));
    });
    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: false, reason: 'closed' } }));
      this._scheduleReconnect();
    });
    this.ws.addEventListener('error', () => {
      // 'close' will fire right after — handle reconnect there.
    });
    this.ws.addEventListener('message', (ev) => this._onMessage(ev));
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, RECONNECT_MS);
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case 'catalog':
        this.catalog = msg.tags || [];
        this.dispatchEvent(new CustomEvent('catalog', { detail: this.catalog }));
        break;
      case 'snapshot':
        this.state = { ...(msg.tags || {}) };
        this.dispatchEvent(new CustomEvent('snapshot', { detail: this.state }));
        // Replay each as an update so subscribers without a snapshot handler catch up.
        for (const [tag, value] of Object.entries(this.state)) {
          this.dispatchEvent(new CustomEvent('update', { detail: { tag, value } }));
        }
        break;
      case 'update':
        this.state[msg.tag] = msg.value;
        this.dispatchEvent(new CustomEvent('update', { detail: { tag: msg.tag, value: msg.value } }));
        break;
      case 'error':
        console.warn('[opcua-ws]', msg.message);
        this.dispatchEvent(new CustomEvent('error', { detail: { message: msg.message } }));
        break;
    }
  }

  /** Send a write command. Returns false if socket is not open. */
  write(tag, value) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: 'write', tag, value }));
    return true;
  }

  getCatalogFor(direction) {
    return this.catalog.filter((t) => t.direction === direction);
  }
}
