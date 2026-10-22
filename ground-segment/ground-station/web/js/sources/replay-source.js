// A recorded session played at its original pace, then repeated. No backend needed:
// the public dashboard on GitHub Pages uses it. The recording (replay.json) is made by
//   python -m dusk1_ground --replay raw.log --export-replay web/replay
import { DataSource } from './data-source.js';

const TIME_FIELDS = ['rx', 'ts'];

export class ReplaySource extends DataSource {
  /** warmupMs: this much of the recording is delivered at once, so a visitor sees charts and pictures straight away. */
  constructor(url = 'replay/replay.json', { fetchImpl, loopPauseMs = 4000, warmupMs = 45000, pageUrl } = {}) {
    super('replay', 'REPLAY · RECORDED');
    this.url = url;
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.loopPauseMs = loopPauseMs;
    this.warmupMs = warmupMs;
    this.pageUrl = pageUrl || (globalThis.location ? globalThis.location.href : 'http://localhost/');
    this.data = null;
    this.meta = {};
    this.timer = null;
  }

  describe() { return `recorded session · ${this.meta.title || 'replay'}`; }

  async load() {
    if (this.data) return this.data;
    const r = await this.fetch(this.url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    this.data = await r.json();
    this.meta = this.data.meta || {};
    this.baseHref = new URL('.', new URL(this.url, this.pageUrl)).href;
    return this.data;
  }

  async start(sink) {
    this.sink = sink;
    this.stopped = false;
    sink(this.linkMsg('CONNECTING'));
    try {
      await this.load();
    } catch (e) {
      if (this.stopped) return;
      sink({ type: 'link', state: 'NO DATA', source: 'recording not found', connected: false });
      sink({ type: 'event', ts: Date.now(), sev: 'ERROR', cat: 'SYSTEM', msg: `Could not load the recorded session (${this.url}): ${e.message}` });
      return;
    }
    if (!this.stopped) this.play();
  }

  play() {
    const msgs = this.data.messages || [];
    this.i = 0;
    this.wall0 = Date.now();
    this.rec0 = (msgs.length ? msgs[0][0] : 0) + this.warmupMs;   // recording time that plays "now"
    this.sink({ type: 'hello', session: this.meta.title || 'replay', link: this.linkMsg('LIVE'), history: [], images: [], events: [], gs: null, boot: null, progress: null, stats: {} });
    this.sink({ type: 'event', ts: Date.now(), sev: 'INFO', cat: 'SYSTEM',
      msg: `Replaying ${this.meta.title || 'a recorded session'}: real data the CanSat sent over the radio and the ground station received` });
    this.step();
  }

  linkMsg(state) {
    return { type: 'link', state, source: `recorded session · ${this.meta.title || ''}`, connected: state === 'LIVE', age: 0 };
  }

  step() {
    if (this.stopped) return;
    const msgs = this.data.messages, now = Date.now(), shift = this.wall0 - this.rec0;
    while (this.i < msgs.length) {
      const [t, m] = msgs[this.i];
      if (this.wall0 + (t - this.rec0) > now) break;
      this.sink(this.prepare(m, shift));
      this.i++;
    }
    if (this.i >= msgs.length) {                  // end of the recording: pause, then again
      this.sink(this.linkMsg('NO DATA'));
      this.timer = setTimeout(() => this.play(), this.loopPauseMs);
      return;
    }
    const next = this.wall0 + (msgs[this.i][0] - this.rec0);
    this.timer = setTimeout(() => this.step(), Math.max(15, next - now));
  }

  /** A copy of the message with its times moved to now and its picture URL made absolute. */
  prepare(m, shift) {
    const c = { ...m };
    for (const f of TIME_FIELDS) if (typeof c[f] === 'number') c[f] += shift;
    if (c.type === 'image' && c.url && !/^(data:|https?:)/.test(c.url)) c.url = new URL(c.url, this.baseHref).href;
    return c;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
