import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DemoSource } from '../../web/js/sources/demo-source.js';
import { LiveSource } from '../../web/js/sources/live-source.js';
import { ReplaySource } from '../../web/js/sources/replay-source.js';

class FakeEventSource {
  static last = null;
  constructor(url) { this.url = url; FakeEventSource.last = this; }
  push(m) { this.onmessage({ data: JSON.stringify(m) }); }
  close() { this.closed = true; }
}

test('live source on a public link: absolute picture URLs, read-only, offline state', async () => {
  const got = [], src = new LiveSource('https://abc.trycloudflare.com/', { transport: 'sse', EventSourceImpl: FakeEventSource, fetchImpl: () => assert.fail('must not POST') });
  src.start(m => got.push(m));
  const es = FakeEventSource.last;
  assert.equal(es.url, 'https://abc.trycloudflare.com/events');
  es.push({ type: 'hello', can_command: true, link: { type: 'link', state: 'LIVE', source: 'COM5' }, images: [{ url: '/images/a.jpg' }] });
  es.push({ type: 'image', url: '/images/b.jpg' });
  assert.equal(got[1].images[0].url, 'https://abc.trycloudflare.com/images/a.jpg');
  assert.equal(got.find(m => m.type === 'image').url, 'https://abc.trycloudflare.com/images/b.jpg');
  assert.equal(src.canCommand, false);                               // a public link never commands
  assert.equal((await src.send('k')).state, 'FAILED');
  es.onerror();
  const last = got[got.length - 1];
  assert.equal(last.state, 'BACKEND OFFLINE');
  assert.equal(last.source, 'COM5');
  src.stop();
  assert.ok(es.closed);
});

test('a public link polls: snapshot first, then only new messages, repeated lines dropped', async () => {
  const urls = [], replies = [
    { seq: 10, messages: [{ type: 'hello', can_command: true, history: [{ type: 'telemetry', pkt: 5, rx: 5000 }], images: [{ url: '/images/a.jpg' }] }] },
    { seq: 12, messages: [{ type: 'telemetry', pkt: 5, rx: 5000 }, { type: 'telemetry', pkt: 6, rx: 6000 }] }];
  const fetchImpl = async url => { urls.push(url); const r = replies.shift(); if (!r) throw new Error('offline'); return { ok: true, json: async () => r }; };
  const got = [], src = new LiveSource('https://abc.trycloudflare.com', { fetchImpl, pollMs: 10 });
  assert.equal(src.transport, 'poll');
  src.start(m => got.push(m));
  await new Promise(r => setTimeout(r, 120));
  src.stop();
  assert.deepEqual(urls.slice(0, 3), ['https://abc.trycloudflare.com/api/poll?after=0', 'https://abc.trycloudflare.com/api/poll?after=10', 'https://abc.trycloudflare.com/api/poll?after=12']);
  assert.deepEqual(got.filter(m => m.type === 'telemetry').map(m => m.pkt), [6]);       // pkt 5 was in the snapshot
  assert.equal(got.find(m => m.type === 'hello').images[0].url, 'https://abc.trycloudflare.com/images/a.jpg');
  assert.equal(src.canCommand, false);
  assert.equal(got.filter(m => m.state === 'BACKEND OFFLINE').length, 1);              // reported once, not on every retry
});

test('live source on the ground station laptop sends commands when the backend allows', async () => {
  const posts = [], src = new LiveSource('', { EventSourceImpl: FakeEventSource, fetchImpl: async (url, opt) => { posts.push([url, opt.body]); return { json: async () => ({ ok: true, msg: 'sent' }) }; } });
  src.start(() => {});
  FakeEventSource.last.push({ type: 'hello', can_command: true });
  assert.deepEqual(await src.send('k'), { state: 'SENT', note: 'sent' });
  assert.deepEqual(posts, [['/api/command', '{"text":"k"}']]);
  assert.equal(src.csvUrl(), '/api/telemetry.csv');
});

test('replay plays recorded messages at their pace, retimed to now', async () => {
  const rec = { meta: { title: 'Bench test' }, messages: [[1000, { type: 'telemetry', pkt: 1, rx: 1000 }], [1040, { type: 'image', id: 1, url: 'images/p.jpg', rx: 1040 }], [1080, { type: 'event', ts: 1080, msg: 'x' }]] };
  const got = [], src = new ReplaySource('https://example.org/DUSK-1/replay/replay.json', { fetchImpl: async () => ({ ok: true, json: async () => rec }), loopPauseMs: 10_000, warmupMs: 0 });
  const t0 = Date.now();
  await src.start(m => got.push(m));
  await new Promise(r => setTimeout(r, 200));
  src.stop();
  const types = got.map(m => m.type);
  assert.deepEqual(types.slice(0, 3), ['link', 'hello', 'event']);
  assert.ok(types.includes('telemetry') && types.includes('image'));
  const tm = got.find(m => m.type === 'telemetry');
  assert.ok(Math.abs(tm.rx - t0) < 1000, 'telemetry time moved to now');
  assert.equal(got.find(m => m.type === 'image').url, 'https://example.org/DUSK-1/replay/images/p.jpg');
  assert.equal(rec.messages[0][1].rx, 1000, 'the recording itself is not changed');
  assert.equal(got[got.length - 1].state, 'NO DATA');              // end of recording
});

test('replay warm-up delivers the start of the recording at once, in the past', async () => {
  const rec = { meta: {}, messages: [[0, { type: 'telemetry', pkt: 1, rx: 0 }], [30_000, { type: 'telemetry', pkt: 31, rx: 30_000 }], [90_000, { type: 'telemetry', pkt: 91, rx: 90_000 }]] };
  const got = [], src = new ReplaySource('replay.json', { fetchImpl: async () => ({ ok: true, json: async () => rec }), warmupMs: 45_000, pageUrl: 'https://x/' });
  const t0 = Date.now();
  await src.start(m => got.push(m));
  src.stop();
  const pkts = got.filter(m => m.type === 'telemetry');
  assert.deepEqual(pkts.map(m => m.pkt), [1, 31]);                 // pkt 91 is 45 s in the future
  assert.ok(Math.abs(pkts[1].rx - (t0 - 15_000)) < 1000, 'pkt 31 happened 15 s ago');
});

test('replay reports a missing recording', async () => {
  const got = [], src = new ReplaySource('replay/replay.json', { fetchImpl: async () => ({ ok: false, status: 404 }), pageUrl: 'https://x/' });
  await src.start(m => got.push(m));
  assert.equal(got.find(m => m.type === 'event').sev, 'ERROR');
});

test('demo speaks the backend protocol and answers commands', async () => {
  const got = [], src = new DemoSource({ drawPicture: () => 'data:image/jpeg;base64,AAAA' });
  await src.start(m => got.push(m));
  src.stop();
  const types = new Set(got.map(m => m.type));
  for (const t of ['link', 'console', 'boot', 'event', 'telemetry', 'stats']) assert.ok(types.has(t), t);
  const tm = got.find(m => m.type === 'telemetry');
  for (const k of ['pkt', 'T', 'RH', 'ax', 'ay', 'az', 'a', 'gx', 'gy', 'gz', 'roll', 'pitch', 'n', 'err']) assert.ok(k in tm, k);
  assert.equal((await src.send('k')).state, 'SIMULATED');
});
