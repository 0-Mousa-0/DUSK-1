// Live data from the ground station backend.
//   new LiveSource('')                                   the page is served by the backend itself: streams (SSE)
//   new LiveSource('https://x.trycloudflare.com')         the public read-only link: polls once a second,
//                                                        because Cloudflare quick tunnels buffer SSE streams
import { DataSource } from './data-source.js';

export class LiveSource extends DataSource {
  constructor(baseUrl = '', { EventSourceImpl = globalThis.EventSource, fetchImpl, transport, pollMs = 1000 } = {}) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    super('live', base ? 'LIVE · PUBLIC LINK' : 'LIVE · BACKEND');
    this.base = base;
    this.remote = !!base;
    this.transport = transport || (base ? 'poll' : 'sse');
    this.pollMs = pollMs;
    this.ES = EventSourceImpl;
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.es = null;
    this.lastLink = null;
  }

  url(path) { return this.base + path; }
  csvUrl() { return this.url('/api/telemetry.csv'); }
  describe(link) { return this.remote ? `public live link · ${this.base}` : (link.source || 'backend'); }

  start(sink) {
    this.sink = sink;
    this.canCommand = false;
    this.lastTeleRx = 0;
    this.emitLink({ type: 'link', state: 'CONNECTING', source: this.base || 'backend', connected: false });
    if (this.transport === 'poll') this.startPolling(); else this.startStream();
  }

  startStream() {
    const es = this.es = new this.ES(this.url('/events'));
    es.onmessage = e => { try { this.receive(JSON.parse(e.data)); } catch (err) { /* a broken line */ } };
    es.onerror = () => this.offline();
  }

  startPolling() {
    const run = this.run = { seq: 0, failures: 0 };
    const loop = async () => {
      if (this.run !== run) return;
      try {
        const r = await this.fetch(this.url('/api/poll?after=' + run.seq), { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (this.run !== run) return;
        j.messages.forEach(m => this.receive(m));
        run.seq = j.seq;
        run.failures = 0;
      } catch (e) {
        if (this.run !== run) return;
        if (run.failures++ === 0) this.offline();
      }
      this.timer = setTimeout(loop, run.failures ? Math.min(5000, 1000 * run.failures) : this.pollMs);
    };
    loop();
  }

  /** One message from the backend, whichever way it came. */
  receive(m) {
    if (m.type === 'hello') {
      this.canCommand = !this.remote && !!m.can_command;
      (m.images || []).forEach(i => this.absolute(i));
      this.lastTeleRx = Math.max(0, ...(m.history || []).map(t => t.rx || 0));
      if (m.link) this.lastLink = m.link;
    }
    if (m.type === 'telemetry') {                 // a poll right after a snapshot can repeat a line
      if (m.rx <= this.lastTeleRx) return;
      this.lastTeleRx = m.rx;
    }
    if (m.type === 'image') this.absolute(m);
    if (m.type === 'link') this.lastLink = m;
    this.sink(m);
    if (m.type === 'hello') this.sink({ type: 'event', ts: Date.now(), sev: 'INFO', cat: 'SYSTEM',
      msg: this.remote ? `Connected to the public live link ${this.base} (read-only)` : 'Dashboard connected to the backend' });
  }

  offline() { this.emitLink({ ...(this.lastLink || { source: this.base || 'backend' }), type: 'link', state: 'BACKEND OFFLINE', connected: false }); }

  emitLink(m) { this.lastLink = m; this.sink(m); }

  absolute(img) { if (this.base && img.url && img.url.startsWith('/')) img.url = this.base + img.url; }

  stop() {
    if (this.es) { this.es.close(); this.es = null; }
    this.run = null;
    clearTimeout(this.timer);
  }

  async send(text) {
    if (!this.canCommand) return { state: 'FAILED', note: 'read-only: commands only from the ground station laptop' };
    try {
      const r = await this.fetch(this.url('/api/command'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const j = await r.json();
      return { state: j.ok ? 'SENT' : 'FAILED', note: j.msg || '' };
    } catch (e) {
      return { state: 'FAILED', note: 'backend not reachable' };
    }
  }
}
