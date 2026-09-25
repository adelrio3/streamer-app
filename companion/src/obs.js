// Listens to OBS over obs-websocket v5 (built into OBS 28 and later) and logs
// the exact moment each recording starts and stops, plus the file it wrote.
// Recordings made while the companion was not running still work: their times
// come from the file name instead.

import crypto from 'node:crypto';

const OP = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, RequestResponse: 7 };
const SUBSCRIBE_OUTPUTS = 1 << 6;

export function authString(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

export class ObsLink {
  // store: the Store; getConfig(): current obs settings.
  constructor(store, getConfig, { WebSocketImpl = globalThis.WebSocket, now = Date.now } = {}) {
    this.store = store;
    this.getConfig = getConfig;
    this.WebSocket = WebSocketImpl;
    this.now = now;
    this.ws = null;
    this.state = 'off';
    this.error = null;
    this.current = null; // { start, path } while recording
    this.timer = null;
    this.stopped = false;
  }

  status() {
    return { state: this.state, error: this.error, recording: Boolean(this.current), since: this.current?.start ?? null };
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.ws) try { this.ws.close(); } catch { /* already closed */ }
    this.ws = null;
    this.state = 'off';
  }

  restart() {
    this.stop();
    this.start();
  }

  connect() {
    const cfg = this.getConfig();
    if (this.stopped || !cfg.enabled) { this.state = 'off'; return; }
    if (!this.WebSocket) {
      this.state = 'error';
      this.error = 'This Node.js has no WebSocket support; use Node 22 or newer.';
      return;
    }
    this.state = 'connecting';
    this.error = null;
    let ws;
    try {
      ws = new this.WebSocket(`ws://${cfg.host}:${cfg.port}`);
    } catch (err) {
      this.fail(err.message);
      return;
    }
    this.ws = ws;
    ws.onmessage = (msg) => this.onMessage(JSON.parse(typeof msg.data === 'string' ? msg.data : msg.data.toString()), cfg);
    ws.onerror = () => { this.error = `Could not reach OBS at ${cfg.host}:${cfg.port}`; };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (ev?.code === 4009) this.error = 'OBS rejected the password.';
      this.fail(this.error || 'Connection closed');
    };
  }

  fail(message) {
    this.state = 'error';
    this.error = message;
    if (!this.stopped) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.connect(), 10000);
      this.timer.unref?.();
    }
  }

  send(op, d) {
    this.ws?.send(JSON.stringify({ op, d }));
  }

  onMessage(msg, cfg) {
    const { op, d } = msg;
    if (op === OP.Hello) {
      const identify = { rpcVersion: 1, eventSubscriptions: SUBSCRIBE_OUTPUTS };
      if (d.authentication) identify.authentication = authString(cfg.password || '', d.authentication.salt, d.authentication.challenge);
      this.send(OP.Identify, identify);
    } else if (op === OP.Identified) {
      this.state = 'connected';
      this.error = null;
      this.send(OP.Request, { requestType: 'GetRecordStatus', requestId: 'status' });
    } else if (op === OP.RequestResponse && d.requestId === 'status') {
      const r = d.responseData;
      if (r?.outputActive && !this.current) {
        // Already recording when we connected: back-date the start.
        this.current = { start: this.now() - (r.outputDuration || 0), path: null };
      }
    } else if (op === OP.Event) {
      this.onEvent(d.eventType, d.eventData || {});
    }
  }

  onEvent(type, data) {
    const t = this.now();
    if (type === 'RecordStateChanged') {
      if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
        this.current = { start: t, path: data.outputPath || null };
      } else if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
        this.finish(t, data.outputPath);
      }
    } else if (type === 'RecordFileChanged') {
      // Automatic file splitting: one file ends where the next begins.
      this.finish(t, null);
      this.current = { start: t, path: data.newOutputPath || null };
    }
  }

  finish(t, path) {
    const cur = this.current;
    this.current = null;
    const file = path || cur?.path;
    if (!cur || !file) return;
    const log = this.store.obsRecordings().filter((r) => r.path !== file);
    log.push({ path: file, start: cur.start, end: t });
    this.store.saveObsRecordings(log);
  }
}
