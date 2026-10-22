import { G0, fx, hms } from '../core/format.js';
import { $, onButton } from './dom.js';

// One entry per chart: series are [field, colour, legend]; ref() gives dashed reference lines.
export const CHARTS = [
  { id: 'T', title: 'Temperature', unit: '°C', dp: 1, s: [['T', 'cy', 'T']], ref: c => [[c.tMax, 'max']] },
  { id: 'RH', title: 'Humidity', unit: '%', dp: 1, s: [['RH', 'gr', 'RH']], ref: () => [] },
  { id: 'a', title: 'Acceleration |a|', unit: 'm/s²', dp: 2, s: [['a', 'or', '|a|']], ref: c => [[G0, '1 g'], [c.aHigh, 'high']] },
  { id: 'att', title: 'Roll and pitch', unit: '°', dp: 1, s: [['roll', 'pu', 'roll'], ['pitch', 'cy', 'pitch']], ref: () => [] },
  { id: 'rate', title: 'Rotation rate', unit: '°/s', dp: 1, s: [['rate', 'pu', 'max |g|']], ref: () => [] },
  { id: 'axes', title: 'Acceleration axes', unit: 'm/s²', dp: 2, s: [['ax', 'cy', 'ax'], ['ay', 'gr', 'ay'], ['az', 'or', 'az']], ref: () => [] }];
const RANGES = [[60, '1 min'], [300, '5 min'], [900, '15 min'], [0, 'All']];
const LABEL = 'fill="#8A93C8" font-size="10" font-family="IBM Plex Mono,monospace"';

export class ChartsView {
  constructor(app) {
    this.app = app;
    this.range = 300;
    this.cache = {};
    onButton($('#rng'), 'r', b => { this.range = +b.dataset.r; this.render(); });
    document.addEventListener('pointermove', e => this.tooltip(e));
  }

  chart(def) {
    const tele = this.app.store.tele, c = this.app.settings.values;
    const W = 600, H = 190, m = { l: 46, r: 12, t: 12, b: 22 }, now = Date.now(), t0 = this.range ? now - this.range * 1000 : (tele[0] ? tele[0].rx : now - 6e4);
    const a = tele.filter(r => r.rx >= t0);
    const legend = def.s.map(s => `<span class="m" style="font-size:10px;color:var(--${s[1]})">● ${s[2]}</span>`).join(' ');
    const head = `<div class="ph"><h2>${def.title} <span style="color:var(--mu)">(${def.unit})</span></h2><span class="row">${legend}</span></div>`;
    if (a.length < 2) return `<div class="panel ch">${head}<div class="empty">Waiting for data in this range</div></div>`;
    let lo = Infinity, hi = -Infinity;
    a.forEach(r => def.s.forEach(s => { const v = r[s[0]]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    const refs = def.ref(c); refs.forEach(x => { lo = Math.min(lo, x[0]); hi = Math.max(hi, x[0]); });
    const pd = (hi - lo) * .1 || 1; lo -= pd; hi += pd;
    const X = t => m.l + (t - t0) / (now - t0) * (W - m.l - m.r), Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    const paths = def.s.map(s => {
      let p = '', pt = 0;
      a.forEach(r => { const v = r[s[0]]; if (v == null) { pt = 0; return; } p += (!pt || r.rx - pt > 3500 ? 'M' : 'L') + X(r.rx).toFixed(1) + ' ' + Y(v).toFixed(1); pt = r.rx; });
      return `<path d="${p}" fill="none" stroke="var(--${s[1]})" stroke-width="1.8" stroke-linejoin="round"/>`;
    }).join('');
    this.cache[def.id] = { W, def, pts: a.map(r => ({ x: X(r.rx), r })) };
    let ax = '';
    for (let i = 0; i < 3; i++) { const v = lo + (hi - lo) * i / 2; ax += `<text x="4" y="${Y(v) + 4}" ${LABEL}>${v.toFixed(def.dp > 1 ? 1 : def.dp)}</text><line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#2C3470" opacity=".5"/>`; }
    ax += `<text x="${m.l}" y="${H - 5}" ${LABEL}>${hms(t0)}</text><text x="${W - m.r}" y="${H - 5}" text-anchor="end" ${LABEL}>${hms(now)}</text>`;
    const rl = refs.map(x => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(x[0])}" y2="${Y(x[0])}" stroke="#FF8C42" stroke-dasharray="5 4" opacity=".8"/><text x="${W - m.r - 2}" y="${Y(x[0]) - 4}" text-anchor="end" fill="#FF8C42" font-size="10" font-family="IBM Plex Mono,monospace">${x[1]}</text>`).join('');
    return `<div class="panel ch" data-id="${def.id}">${head}<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${def.title} chart">${ax}${rl}${paths}<line class="cur" y1="${m.t}" y2="${H - m.b}" stroke="#E8ECFF" opacity=".35" style="display:none"/></svg></div>`;
  }

  render() {
    $('#rng').innerHTML = RANGES.map(r => `<button class="btn ${this.range === r[0] ? 'on' : ''}" type="button" data-r="${r[0]}">${r[1]}</button>`).join('');
    $('#chs').innerHTML = CHARTS.map(d => this.chart(d)).join('');
  }

  tooltip(e) {
    const c = e.target.closest && e.target.closest('.ch[data-id]'), tip = $('#tip');
    if (!c) { tip.style.display = 'none'; document.querySelectorAll('.cur').forEach(x => { x.style.display = 'none'; }); return; }
    const ch = this.cache[c.dataset.id], s = c.querySelector('svg'), cur = c.querySelector('.cur');
    if (!ch || !s || !ch.pts.length) return;
    const r = s.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * ch.W;
    let n = ch.pts[0];
    for (const p of ch.pts) if (Math.abs(p.x - x) < Math.abs(n.x - x)) n = p;
    cur.setAttribute('x1', n.x); cur.setAttribute('x2', n.x); cur.style.display = '';
    tip.style.display = 'block';
    tip.textContent = `${n.r.t}\n` + ch.def.s.map(sr => `${sr[2]}: ${fx(n.r[sr[0]], ch.def.dp)} ${ch.def.unit}`).join('\n');
    tip.style.left = Math.min(e.clientX + 12, innerWidth - 190) + 'px'; tip.style.top = (e.clientY - 40) + 'px';
  }
}
