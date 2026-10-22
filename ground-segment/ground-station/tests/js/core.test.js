import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AlertMonitor } from '../../web/js/core/alerts.js';
import { CommandHistory, PRESETS, presetText } from '../../web/js/core/commands.js';
import { ago, esc, fx } from '../../web/js/core/format.js';
import { Settings } from '../../web/js/core/settings.js';
import { MissionStore, rotationRate } from '../../web/js/core/store.js';
import { toCsv } from '../../web/js/ui/data-view.js';

const tele = (pkt, extra = {}) => ({ type: 'telemetry', t: '2026-10-21 18:30:00', rx: 1000 * pkt, pkt, T: 25.1, RH: 38.6, a: 9.84, az: 9.83, gx: 0.1, gy: -0.2, gz: 0.05, roll: -2.2, pitch: -2.5, n: 100, err: 0, ...extra });

test('format helpers', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.equal(fx(null, 1), '—');
  assert.equal(fx(9.8366, 2), '9.84');
  assert.equal(ago(0.5), 'now');
  assert.equal(ago(42), '42 s ago');
});

test('store keeps telemetry, derives rotation rate and loss', () => {
  const s = new MissionStore(), seen = [];
  s.subscribe(m => seen.push(m.type));
  s.ingest(tele(1, { gx: -3, gy: 1 }));
  s.ingest({ type: 'stats', lines: 10, telemetry: 377, lost: 3 });
  assert.equal(s.latest.pkt, 1);
  assert.equal(s.latest.rate, 3);
  assert.equal(rotationRate({ gx: 0.2, gy: -0.1 }), 0.2);
  assert.equal(s.lossPct().toFixed(1), '0.8');                 // 3 of 380
  assert.equal(s.stats.type, undefined);
  assert.deepEqual(seen, ['telemetry', 'stats']);
});

test('hello replaces everything, image clears its progress, unknown types are ignored', () => {
  const s = new MissionStore();
  s.ingest(tele(1));
  s.ingest({ type: 'hello', session: 'session_x', history: [tele(5), tele(6)], images: [{ id: 1 }], events: [{ msg: 'a' }], stats: { telemetry: 2 } });
  assert.equal(s.tele.length, 2);
  assert.equal(s.latest.pkt, 6);
  assert.equal(s.session, 'session_x');
  s.ingest({ type: 'img_progress', id: 2, got: 3, total: 9 });
  s.ingest({ type: 'image', id: 2, url: 'x.jpg' });
  assert.equal(s.progress, null);
  assert.equal(s.images.length, 2);
  let called = false; s.subscribe(() => { called = true; });
  s.ingest({ type: 'something-new' });
  assert.equal(called, false);
});

test('alerts fire once and re-arm', () => {
  const settings = new Settings(null), alerts = new AlertMonitor(settings, undefined, () => 7);
  assert.equal(alerts.check(tele(1, { a: 25 })).length, 1);
  assert.equal(alerts.check(tele(2, { a: 26 })).length, 0);     // still high: no repeat
  assert.equal(alerts.check(tele(3, { a: 9.8 })).length, 0);
  const [ev] = alerts.check(tele(4, { a: 2 }));                   // free fall
  assert.match(ev.msg, /Free fall/);
  assert.equal(ev.ts, 7);
});

test('settings work without browser storage', () => {
  const s = new Settings(null);
  assert.equal(s.values.name, 'DUSK-1');
  s.set('tMax', 30);
  assert.equal(s.values.tMax, 30);
});

test('command history and presets', () => {
  const h = new CommandHistory(2);
  const c = h.add('k', 'Take picture now');
  h.update(c, 'SENT', 'sent');
  h.add('i'); h.add('v');
  assert.equal(h.items.length, 2);
  assert.equal(h.items[0].text, 'v');
  assert.match(presetText(PRESETS[3]), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);   // clock sync
});

test('CSV export has the dashboard columns', () => {
  const csv = toCsv([tele(1, { T: null })]).split('\n');
  assert.equal(csv[0], 'cansat_time,pkt,T,RH,ax,ay,az,|a|,gx,gy,gz,roll,pitch,n,err');
  assert.equal(csv[1].split(',')[2], '');                          // missing DHT reading
});
