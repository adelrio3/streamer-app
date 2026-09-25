import test from 'node:test';
import assert from 'node:assert/strict';
import { authString, ObsLink } from '../web/lib/obs.js';

test('auth string matches the obs-websocket protocol example', async () => {
  assert.equal(
    await authString('supersecretpassword', 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=', '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY='),
    '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=',
  );
});

class FakeSocket {
  static last;
  constructor(url) { this.url = url; this.sent = []; FakeSocket.last = this; }
  send(text) {
    const msg = JSON.parse(text);
    this.sent.push(msg);
    if (msg.op === 6) {
      const data = { GetRecordDirectory: { recordDirectory: '/Users/me/Movies' }, GetRecordStatus: { outputActive: false } }[msg.d.requestType];
      queueMicrotask(() => this.emit(7, { requestId: msg.d.requestId, responseData: data }));
    }
  }
  close() {}
  emit(op, d) { return this.onmessage({ data: JSON.stringify({ op, d }) }); }
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test('reports recording start, file splits and stop', async () => {
  let clock = 1_000_000;
  const events = [];
  const link = new ObsLink({ password: 'pw', WebSocketImpl: FakeSocket, now: () => clock, onRecording: (e) => events.push(e) });
  link.start();
  const ws = FakeSocket.last;
  assert.equal(ws.url, 'ws://127.0.0.1:4455');
  await ws.emit(0, { rpcVersion: 1, authentication: { salt: 's', challenge: 'c' } });
  assert.equal(ws.sent[0].d.authentication, await authString('pw', 's', 'c'));
  await ws.emit(2, {});
  await tick();
  assert.equal(link.status().state, 'connected');
  assert.equal(link.status().recordDirectory, '/Users/me/Movies');

  await ws.emit(5, { eventType: 'RecordStateChanged', eventData: { outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED', outputPath: '/m/a.mp4' } });
  clock += 60_000;
  await ws.emit(5, { eventType: 'RecordFileChanged', eventData: { newOutputPath: '/m/b.mp4' } });
  clock += 30_000;
  await ws.emit(5, { eventType: 'RecordStateChanged', eventData: { outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED', outputPath: '/m/b.mp4' } });
  assert.deepEqual(events.map((e) => [e.type, e.path, e.at]), [
    ['start', '/m/a.mp4', 1_000_000], ['stop', '/m/a.mp4', 1_060_000], ['start', '/m/b.mp4', 1_060_000], ['stop', '/m/b.mp4', 1_090_000],
  ]);
  assert.equal(events[3].start, 1_060_000);
  link.stop();
});
