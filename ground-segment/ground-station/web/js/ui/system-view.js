import { ago, esc, fx } from '../core/format.js';
import { $, kv } from './dom.js';

const HOW_TO = [
  'Wire the ground radio to the Ground OBC (UNO R4 WiFi): radio TX → D0, D1 → radio RX, 5V → 5V, GND → GND. Power it by USB-C. Its LED matrix shows moving dots while it waits.',
  'Both radios must share the same private network ID (not the factory 25), and the R4 needs Wi-Fi firmware 0.6.0 or newer. See the ground segment README.',
  'Double-click <b>start_ground_station.bat</b> in <span class="m">ground-segment/ground-station</span>: USB (UNO R4 on its COM port) or Wi-Fi (join <b>DUSK1-GROUND</b>, password <b>dusk2026</b>).',
  'Open <span class="m">http://localhost:8080</span>. This page switches to LIVE by itself.',
  'Power the CanSat. Telemetry appears within seconds, pictures every 15 s.',
  'To let anyone watch: run with <span class="m">--share</span> (or option 5 of the launcher) and send the public read-only link it prints.'];

export class SystemView {
  constructor(app) {
    this.app = app;
    document.querySelectorAll('[data-k]').forEach(e => e.addEventListener('change', () => {
      const k = e.dataset.k, v = e.type === 'number' ? +e.value : e.value;
      if (e.type === 'number' && (e.value === '' || isNaN(v))) return;
      app.settings.set(k, v);
    }));
    $('#clrBtn').onclick = () => app.clearScreen();
  }

  onShow() {
    document.querySelectorAll('[data-k]').forEach(e => { if (e !== document.activeElement) e.value = this.app.settings.values[e.dataset.k]; });
  }

  colors() {
    const { store, source } = this.app, L = store.link.state, gsAge = store.gs ? (Date.now() - store.gs.ts) / 1000 : null;
    if (source.kind === 'demo') return { sat: 'pu', radio: 'pu', obc: 'pu', wifi: 'pu', be: 'pu', ui: 'gr' };
    if (source.kind === 'replay') return { sat: 'cy', radio: 'cy', obc: 'cy', wifi: 'cy', be: 'cy', ui: 'gr' };
    const up = store.link.connected;
    return { sat: L === 'LIVE' ? 'gr' : 'rd', radio: L === 'LIVE' ? 'gr' : (up ? 'ye' : 'rd'), obc: gsAge != null && gsAge < 12 ? 'gr' : (up ? 'ye' : 'rd'),
      wifi: up ? 'gr' : 'rd', be: L === 'BACKEND OFFLINE' ? 'rd' : 'gr', ui: 'gr' };
  }

  chain() {
    const c = this.colors(), remote = this.app.source.remote;
    const N = [['CanSat', 'DUSK-1 space', 'segment', c.sat], ['Ground radio', 'SiK V3 + antenna', '915 MHz', c.radio], ['Ground OBC', 'UNO R4 WiFi', 'D0 / D1', c.obc],
      ['Wi-Fi / USB', 'DUSK1-GROUND', 'TCP 5760 / COM', c.wifi], ['Backend', 'dusk1_ground', 'saves files', c.be], ['Dashboard', 'this page', remote ? 'public link' : 'port 8080', c.ui]];
    const w = 150, gap = 22, labels = ['radio', 'UART 57600', 'Wi-Fi / USB', 'lines', 'live push'];
    let g = '';
    N.forEach((n, i) => {
      const x = 10 + i * (w + gap);
      g += `<rect x="${x}" y="20" width="${w}" height="86" rx="10" fill="#070B1F" stroke="#2C3470"/><circle cx="${x + 14}" cy="38" r="5" fill="var(--${n[3]})"/><text x="${x + 26}" y="42" fill="#E8ECFF" font-size="13" font-weight="600" font-family="IBM Plex Sans,sans-serif">${n[0]}</text><text x="${x + 12}" y="66" fill="#8A93C8" font-size="11" font-family="IBM Plex Mono,monospace">${n[1]}</text><text x="${x + 12}" y="84" fill="#8A93C8" font-size="11" font-family="IBM Plex Mono,monospace">${n[2]}</text>`;
      if (i < N.length - 1) {
        const x2 = x + w, col = i === 0 ? '#A58BFF' : '#5CC8FF';
        g += `<line x1="${x2 + 2}" y1="63" x2="${x2 + gap - 4}" y2="63" stroke="${col}" stroke-width="2" ${i === 0 ? '' : 'stroke-dasharray="5 4"'}/><polygon points="${x2 + gap - 2},63 ${x2 + gap - 8},59 ${x2 + gap - 8},67" fill="${col}"/><text x="${x2 + gap / 2}" y="124" text-anchor="middle" fill="#8A93C8" font-size="9" font-family="IBM Plex Mono,monospace">${labels[i]}</text>`;
      }
    });
    return `<svg viewBox="0 0 ${10 + N.length * (w + gap)} 132" style="min-width:860px" role="img" aria-label="Ground segment chain from the CanSat through the ground radio, Ground OBC and Wi-Fi or USB to the backend and this dashboard">${g}</svg>`;
  }

  render() {
    const { store, source } = this.app, gsAge = store.gs ? (Date.now() - store.gs.ts) / 1000 : null;
    $('#chain').innerHTML = this.chain();
    const [tag, cls] = { live: ['LIVE STATUS', 'g'], replay: ['RECORDED', 'g'], demo: ['SIMULATED', 'w'] }[source.kind];
    $('#chainTag').textContent = tag; $('#chainTag').className = 'tag ' + cls;
    const f = store.gs && store.gs.fields;
    $('#gsTag').textContent = f ? 'status ' + ago(gsAge) : 'no status yet';
    $('#gsKv').innerHTML = f ? kv('Uptime', `${esc(f.up)} s`) + kv('Wi-Fi', esc(f.wifi)) + kv('IP address', esc(f.ip)) + kv('Laptops connected', esc(f.laptops)) + kv('Lines received', esc(f.lines))
      + kv('Telemetry lines', esc(f.telemetry)) + kv('Lost (its count)', esc(f.lost)) + kv('Damaged picture pieces', esc(f.bad_pieces)) + kv('Pictures complete', esc(f.pictures)) + (f.wifi_drops !== undefined ? kv('Lines dropped on Wi-Fi', esc(f.wifi_drops)) : '')
      : '<div class="empty">The Ground OBC sends a status line every 5 s.</div>';
    const s = store.stats;
    $('#lqKv').innerHTML = kv('Telemetry received', s.telemetry || 0) + kv('Lines lost', s.lost || 0) + kv('Packet loss', fx(store.lossPct(), 1) + ' %') + kv('All lines', s.lines || 0)
      + kv('Boot-noise lines hidden', s.noise || 0) + kv('Damaged picture pieces', s.bad_pieces || 0) + kv('Pictures complete / partial', `${s.pictures_ok || 0} / ${s.pictures_partial || 0}`) + kv('Last telemetry', ago(store.teleAge()));
    $('#howTo').innerHTML = HOW_TO.map(t => `<li>${t}</li>`).join('');
  }
}
