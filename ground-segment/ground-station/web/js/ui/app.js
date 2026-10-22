// DashboardApp: owns the active data source and the tabs, and redraws the active view
// when the store changes. Views never talk to each other; they go through the app.
import { $, $$ } from './dom.js';

export const TABS = [['overview', 'Overview'], ['camera', 'Camera'], ['charts', 'Charts'], ['cmd', 'Commands'], ['data', 'Data'], ['log', 'Event log'], ['system', 'System']];

export class DashboardApp {
  constructor({ store, settings, alerts, commands, sources }) {
    Object.assign(this, { store, settings, alerts, commands, sources });
    this.sourceIndex = 0;
    this.source = null;
    this.act = 'overview';
    this.newPics = 0;
    this.views = {};
    this.header = null;
    this.queued = false;
    store.subscribe(m => this.onMessage(m));
    settings.subscribe(() => this.render());
    commands.subscribe(() => { if (this.act === 'cmd') this.render(); });
  }

  register(tab, view) { this.views[tab] = view; }

  onMessage(m) {
    if (m.type === 'telemetry') this.alerts.check(m).forEach(e => this.store.ingest(e));
    if (m.type === 'image' && this.act !== 'camera') this.newPics++;
    if (m.type === 'reset') this.newPics = 0;
    for (const v of Object.values(this.views)) if (v.onMessage) v.onMessage(m);
    this.render();
  }

  // ------------------------------------------------------------ sources
  useSource(i) {
    if (this.source) this.source.stop();
    this.sourceIndex = i;
    this.source = this.sources[i];
    this.store.reset();
    this.alerts.reset();
    this.source.start(m => this.store.ingest(m));
    this.render();
  }

  nextSource() { this.useSource((this.sourceIndex + 1) % this.sources.length); }

  /** Clears the screen; the demo restarts its mission, other sources keep streaming. */
  clearScreen() {
    if (this.source.kind === 'demo') this.useSource(this.sourceIndex);
    else { this.store.reset(); this.alerts.reset(); }
    this.store.ingest({ type: 'event', ts: Date.now(), sev: 'INFO', cat: 'SYSTEM', msg: 'Screen data cleared (files on disk are kept)' });
  }

  async sendCommand(text, label) {
    if (!text) return;
    const c = this.commands.add(text, label);
    const r = await this.source.send(text);
    this.commands.update(c, r.state, r.note);
    this.render();
  }

  // ------------------------------------------------------------ tabs
  go(tab) {
    this.act = tab;
    TABS.forEach(([id]) => $('#s-' + id).classList.toggle('on', id === tab));
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'camera') this.newPics = 0;
    const v = this.views[tab];
    if (v && v.onShow) v.onShow();
    this.draw();
  }

  openPicture(i) {
    this.views.camera.select(i);
    if (this.act !== 'camera') this.go('camera'); else this.draw();
  }

  // ------------------------------------------------------------ drawing
  render() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.draw(); });
  }

  draw() {
    if (!this.source) return;
    this.header.render();
    const v = this.views[this.act];
    if (v) v.render();
  }

  /** Once a second: the clock and the "x s ago" texts. */
  tick() {
    if (!this.source) return;
    this.header.render();
    if (this.act === 'overview' || this.act === 'system') this.views[this.act].render();
  }

  mount() {
    $('#tabs').innerHTML = TABS.map(([id, name]) => `<button type="button" data-t="${id}">${name}</button>`).join('');
    $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (b) this.go(b.dataset.t); });
    setInterval(() => this.tick(), 1000);
    const start = (location.hash || '').slice(1);
    this.go(TABS.some(t => t[0] === start) ? start : 'overview');
  }
}
