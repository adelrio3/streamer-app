// Talks to OBS on the same computer over obs-websocket v5 (built into OBS 28
// and later: Tools > WebSocket Server Settings). Chrome lets a web page reach
// OBS on the same machine; it may ask once to allow access to local apps.

const OP = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, RequestResponse: 7 };
const SUBSCRIBE_OUTPUTS = 1 << 6;

async function sha256Base64(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let bin = '';
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function authString(password, salt, challenge) {
  return sha256Base64((await sha256Base64(password + salt)) + challenge);
}

// onRecording({ type: 'start' | 'stop', path, at }) is called with local
// Date.now() times; the caller converts them to the shared clock.
export class ObsLink {
  constructor({ host = '127.0.0.1', port = 4455, password = '', onRecording, onStatus, WebSocketImpl = globalThis.WebSocket, now = () => Date.now() } = {}) {
    Object.assign(this, { host, port, password, onRecording, onStatus, WebSocketImpl, now });
    this.state = 'off';
    this.error = null;
    this.recording = null; // { start, path }
    this.recordDirectory = null;
    this.pending = new Map();
    this.stopped = true;
  }

  status() {
    return { state: this.state, error: this.error, recording: Boolean(this.recording), since: this.recording?.start ?? null, recordDirectory: this.recordDirectory };
  }

  setStatus(state, error = null) {
    this.state = state;
    this.error = error;
    this.onStatus?.(this.status());
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    try { this.ws?.close(); } catch { /* already closed */ }
    this.ws = null;
    this.setStatus('off');
  }

  connect() {
    if (this.stopped) return;
    this.setStatus('connecting');
    let ws;
    try {
      ws = new this.WebSocketImpl(`ws://${this.host}:${this.port}`);
    } catch (err) {
      this.retry(err.message);
      return;
    }
    this.ws = ws;
    ws.onmessage = (msg) => this.onMessage(JSON.parse(msg.data));
    ws.onerror = () => { this.error = 'OBS is not reachable. Is OBS open with its WebSocket server enabled?'; };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.retry(ev?.code === 4009 ? 'OBS rejected the password.' : this.error || 'Connection to OBS closed.');
    };
  }

  retry(message) {
    this.setStatus('error', message);
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), 10000);
  }

  send(op, d) {
    this.ws?.send(JSON.stringify({ op, d }));
  }

  request(requestType, requestData) {
    const requestId = `r${Math.random().toString(36).slice(2)}`;
    this.send(OP.Request, { requestType, requestId, requestData });
    return new Promise((resolve) => this.pending.set(requestId, resolve));
  }

  async onMessage({ op, d }) {
    if (op === OP.Hello) {
      const identify = { rpcVersion: 1, eventSubscriptions: SUBSCRIBE_OUTPUTS };
      if (d.authentication) identify.authentication = await authString(this.password || '', d.authentication.salt, d.authentication.challenge);
      this.send(OP.Identify, identify);
    } else if (op === OP.Identified) {
      this.setStatus('connected');
      const dir = await this.request('GetRecordDirectory');
      this.recordDirectory = dir?.recordDirectory ?? null;
      const rec = await this.request('GetRecordStatus');
      if (rec?.outputActive && !this.recording) {
        // Already recording when we connected: back-date the start.
        this.recording = { start: this.now() - (rec.outputDuration || 0), path: null };
        this.onRecording?.({ type: 'start', at: this.recording.start, path: null, late: true });
      }
      this.onStatus?.(this.status());
    } else if (op === OP.RequestResponse) {
      const resolve = this.pending.get(d.requestId);
      this.pending.delete(d.requestId);
      resolve?.(d.responseData ?? null);
    } else if (op === OP.Event) {
      this.onEvent(d.eventType, d.eventData || {});
    }
  }

  onEvent(type, data) {
    const at = this.now();
    if (type === 'RecordStateChanged') {
      if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
        this.recording = { start: at, path: data.outputPath || null };
        this.onRecording?.({ type: 'start', at, path: this.recording.path });
      } else if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
        this.finish(at, data.outputPath);
      }
    } else if (type === 'RecordFileChanged') {
      // Automatic file splitting: one file ends where the next begins.
      this.finish(at, null);
      this.recording = { start: at, path: data.newOutputPath || null };
      this.onRecording?.({ type: 'start', at, path: this.recording.path });
    }
    this.onStatus?.(this.status());
  }

  finish(at, path) {
    const cur = this.recording;
    this.recording = null;
    if (!cur) return;
    this.onRecording?.({ type: 'stop', at, start: cur.start, path: path || cur.path });
  }
}
