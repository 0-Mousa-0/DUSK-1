// MissionStore: the one place the dashboard keeps mission data.
// Every data source (live backend, recorded replay, demo simulator) feeds it the same
// messages (see ground-station/dusk1_ground/messages.py); every view only reads it.
const LIMITS = { tele: 3600, events: 500, console: 300 };

export const emptyStats = () => ({ lines: 0, telemetry: 0, lost: 0, noise: 0, bad_pieces: 0, pictures_ok: 0, pictures_partial: 0 });

/** Rotation rate shown on the dashboard: the fastest of the three gyro axes, °/s. */
export const rotationRate = m => Math.max(Math.abs(m.gx || 0), Math.abs(m.gy || 0), Math.abs(m.gz || 0));

function push(list, item, limit) {
  list.push(item);
  if (list.length > limit) list.splice(0, list.length - limit);
}

export class MissionStore {
  constructor() {
    this.listeners = new Set();
    this.clear();
  }

  clear() {
    this.link = { state: 'CONNECTING', source: '' };
    this.tele = [];
    this.latest = null;
    this.images = [];
    this.progress = null;
    this.events = [];
    this.console = [];
    this.gs = null;
    this.boot = null;
    this.stats = emptyStats();
    this.session = '';
  }

  /** Empties the screen data and tells every listener ({type: 'reset'}). */
  reset() { this.clear(); this.emit({ type: 'reset' }); }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(m) { for (const fn of [...this.listeners]) fn(m, this); }

  ingest(m) {
    switch (m.type) {
      case 'hello':                              // a full snapshot: replaces everything
        this.session = m.session || '';
        if (m.link) this.link = m.link;
        this.gs = m.gs || null;
        this.boot = m.boot || null;
        this.progress = m.progress || null;
        this.stats = { ...emptyStats(), ...(m.stats || {}) };
        this.tele = [];
        this.latest = null;
        (m.history || []).forEach(t => this.addTelemetry(t));
        this.images = (m.images || []).slice();
        this.events = (m.events || []).slice();
        break;
      case 'telemetry': this.addTelemetry(m); break;
      case 'image':
        this.images.push(m);
        if (this.progress && this.progress.id === m.id) this.progress = null;
        break;
      case 'img_progress': this.progress = m; break;
      case 'event': push(this.events, m, LIMITS.events); break;
      case 'console': push(this.console, m.text, LIMITS.console); break;
      case 'gs': this.gs = m; break;
      case 'boot': this.boot = m; break;
      case 'link': this.link = m; break;
      case 'stats': { const { type, ...counters } = m; this.stats = { ...emptyStats(), ...counters }; break; }
      default: return;                           // unknown message type: ignored
    }
    this.emit(m);
  }

  addTelemetry(m) {
    m.rate = rotationRate(m);
    push(this.tele, m, LIMITS.tele);
    this.latest = m;
  }

  lossPct() {
    const s = this.stats, t = (s.telemetry || 0) + (s.lost || 0);
    return t ? s.lost / t * 100 : 0;
  }

  teleAge(now = Date.now()) { return this.latest ? (now - this.latest.rx) / 1000 : null; }
}
