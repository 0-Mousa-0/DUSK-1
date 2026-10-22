import { G0, ago, esc, fx } from '../core/format.js';
import { $, LINK_COLORS, dot, kv, onButton } from './dom.js';
import { horizon } from './horizon.js';

// The telemetry cards. One row per card: [field, label, unit, decimals, colour, level(v, settings), footer(v)].
// A new card is one more row here (open/closed).
export const CARDS = [
  ['T', 'Temperature', '°C', 1, 'cy', (v, c) => v > c.tMax ? 'crit' : ''],
  ['RH', 'Humidity', '%', 1, 'gr'],
  ['a', 'Acceleration |a|', 'm/s²', 2, 'or', (v, c) => v > c.aHigh || v < c.aFree ? 'warn' : '', v => fx(v / G0, 2) + ' g'],
  ['az', 'Vertical az', 'm/s²', 2, 'or'],
  ['roll', 'Roll', '°', 1, 'pu'],
  ['pitch', 'Pitch', '°', 1, 'pu'],
  ['rate', 'Rotation rate', '°/s', 1, 'pu', v => v > 180 ? 'warn' : ''],
  ['n', 'Samples / s', '', 0, 'cy', v => v < 95 ? 'warn' : ''],
  ['err', 'I2C errors', '', 0, 'cy', v => v > 0 ? 'warn' : ''],
  ['loss', 'Packet loss', '%', 1, 'cy', v => v > 5 ? 'warn' : '']];

const NOTES = {
  live: 'Live data from the CanSat through the ground station. The backend saves every line, picture and event in its session folder.',
  remote: 'Live data from the CanSat, shared read-only from the DUSK-1 ground station laptop through a public link.',
  replay: 'Recorded session: real data the CanSat sent over the 915 MHz radio and the DUSK-1 ground station received. It plays at the original pace and repeats.',
  demo: 'Demo: a simulated mission (pad, launch, parachute descent, landing) repeating every 4 minutes. No hardware is connected. Run the ground station and open http://localhost:8080 for live data.' };

export class OverviewView {
  constructor(app) {
    this.app = app;
    onButton($('#lastPic'), 'pic', b => app.openPicture(+b.dataset.pic));
  }

  card([k, label, unit, dp, col, level, foot]) {
    const { store, settings } = this.app, l = store.latest, age = store.teleAge();
    const v = k === 'loss' ? (store.stats.telemetry ? store.lossPct() : null) : l ? l[k] : null, stale = age != null && age > 5;
    const cls = v != null && level ? level(v, settings.values) : '';
    const ft = v == null ? 'no data yet' : foot ? foot(v) : k === 'loss' ? `${store.stats.lost || 0} of ${(store.stats.telemetry || 0) + (store.stats.lost || 0)} lines` : (stale ? 'STALE · ' : '') + ago(age);
    return `<div class="card ${cls}"><div class="cl">${dot(col)}${label}</div><div class="cv">${fx(v, dp)}<small>${unit}</small></div><div class="cf">${ft}</div></div>`;
  }

  motion() {
    const a = this.app.store.tele.slice(-5), c = this.app.settings.values;
    if (!a.length) return ['—', 'mu'];
    const l = a[a.length - 1];
    if (l.a > c.aHigh) return ['HIGH-G', 'ye'];
    if (l.a < c.aFree) return ['FREE FALL', 'rd'];
    if (a.length >= 3 && a.every(m => m.rate < 3 && Math.abs(m.a - G0) < .5)) return ['STILL', 'gr'];
    return ['MOVING', 'cy'];
  }

  render() {
    const { store, settings, source } = this.app, c = settings.values;
    const L = store.link.state, l = store.latest, b = store.boot, gs = store.gs, s = store.stats;
    const kind = source.remote ? 'remote' : source.kind;
    $('#mStat').innerHTML = `<span class="pill">${dot(LINK_COLORS[L] || 'mu')}${esc(L)}</span>`;
    const bf = b && b.fields ? b.fields : {};
    const saving = { live: store.session ? 'dusk1_data/' + esc(store.session) : '—', remote: 'on the ground station laptop', replay: 'nothing (recorded session)', demo: 'nothing (demo)' }[kind];
    $('#mKv').innerHTML = kv('Mission', esc(c.name) + ' · ' + esc(c.team)) + kv('Launch site', esc(c.site))
      + kv('Data source', esc(source.describe(store.link))) + kv('Link', esc(L))
      + kv('Last telemetry', l ? ago(store.teleAge()) : 'never') + kv('CanSat clock', l ? esc(l.t) : '—')
      + kv('Lines received / lost', `${s.telemetry || 0} / ${s.lost || 0} (${fx(store.lossPct(), 1)} %)`) + kv('Pictures complete / partial', `${s.pictures_ok || 0} / ${s.pictures_partial || 0}`)
      + kv('Last start', b ? `${esc(bf.reset || '?')} · mpu ${esc(bf.mpu || '?')} · dht ${esc(bf.dht || '?')} · cam ${esc(bf.cam || '?')}` : 'not seen yet')
      + kv('Gravity correction', esc(bf.gravity || '—')) + kv('Ground OBC', gs && gs.fields ? `up ${esc(gs.fields.up)} s · ${esc(gs.fields.laptops)} laptop(s)` : 'no status yet')
      + kv('Saving to', saving);
    $('#mNote').textContent = NOTES[kind];
    const [tag, tcls] = { live: ['LIVE DATA', 'g'], remote: ['LIVE DATA', 'g'], replay: ['RECORDED DATA', 'g'], demo: ['SIMULATED DATA', 'w'] }[kind];
    $('#srcTag').textContent = tag; $('#srcTag').className = 'tag ' + tcls;
    $('#tg').innerHTML = CARDS.map(cd => this.card(cd)).join('');
    const [mo, mc] = this.motion(); $('#motionTag').innerHTML = `${dot(mc)} ${mo}`;
    $('#horizon').innerHTML = horizon(l && l.roll, l && l.pitch);
    $('#attKv').innerHTML = kv('Roll', fx(l && l.roll, 1) + ' °') + kv('Pitch', fx(l && l.pitch, 1) + ' °') + kv('Rotation rate', fx(l && l.rate, 1) + ' °/s')
      + kv('|a|', l ? `${fx(l.a, 2)} m/s² · ${fx(l.a / G0, 2)} g` : '—') + kv('Motion', mo) + (l && l.phase ? kv('Simulated phase', esc(l.phase)) : '');
    const n = store.images.length, im = store.images[n - 1];
    $('#lastPicTag').textContent = im ? `#${im.id} · ${im.complete ? 'complete' : 'partial'}` : 'none yet';
    $('#lastPic').innerHTML = im ? `<button class="thumb" type="button" data-pic="${n - 1}" aria-label="Open picture ${im.id} in the camera tab"><img src="${esc(im.url)}" alt="Picture ${im.id} from the CanSat camera"></button><p class="n">Picture ${im.id} · CanSat time ${esc(im.t)} · ${im.w}×${im.h} · ${fx(im.bytes / 1024, 1)} kB</p>`
      : '<div class="empty">No pictures yet. The CanSat sends one every 15 s.</div>';
  }
}
