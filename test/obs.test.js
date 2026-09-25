import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authString, ObsLink } from '../companion/src/obs.js';
import { Store } from '../companion/src/store.js';

test('auth string matches the obs-websocket protocol example', () => {
  assert.equal(
    authString('supersecretpassword', 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=', '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY='),
    '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=',
  );
});

class FakeSocket {
  static last;
  constructor(url) { this.url = url; this.sent = []; FakeSocket.last = this; }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() {}
  emit(op, d) { this.onmessage({ data: JSON.stringify({ op, d }) }); }
}

test('logs recording start, file splits and stop', () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'chron-obs-')));
  let clock = 1_000_000;
  const link = new ObsLink(store, () => ({ enabled: true, host: 'localhost', port: 4455, password: 'pw' }), { WebSocketImpl: FakeSocket, now: () => clock });
  link.start();
  const ws = FakeSocket.last;
  assert.equal(ws.url, 'ws://localhost:4455');

  ws.emit(0, { rpcVersion: 1, authentication: { salt: 's', challenge: 'c' } });
  assert.equal(ws.sent[0].op, 1);
  assert.equal(ws.sent[0].d.authentication, authString('pw', 's', 'c'));
  ws.emit(2, { negotiatedRpcVersion: 1 });
  assert.equal(link.status().state, 'connected');

  ws.emit(5, { eventType: 'RecordStateChanged', eventData: { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED', outputPath: '/v/a.mkv' } });
  clock += 60_000;
  ws.emit(5, { eventType: 'RecordFileChanged', eventData: { newOutputPath: '/v/b.mkv' } });
  clock += 30_000;
  ws.emit(5, { eventType: 'RecordStateChanged', eventData: { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED', outputPath: '/v/b.mkv' } });

  assert.deepEqual(store.obsRecordings(), [
    { path: '/v/a.mkv', start: 1_000_000, end: 1_060_000 },
    { path: '/v/b.mkv', start: 1_060_000, end: 1_090_000 },
  ]);
  link.stop();
});

test('back-dates a recording already running when it connects', () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'chron-obs-')));
  const link = new ObsLink(store, () => ({ enabled: true, host: 'h', port: 1 }), { WebSocketImpl: FakeSocket, now: () => 500_000 });
  link.start();
  const ws = FakeSocket.last;
  ws.emit(0, { rpcVersion: 1 });
  assert.equal(ws.sent[0].d.authentication, undefined);
  ws.emit(2, {});
  ws.emit(7, { requestId: 'status', responseData: { outputActive: true, outputDuration: 120_000 } });
  assert.equal(link.status().since, 380_000);
  link.stop();
});
