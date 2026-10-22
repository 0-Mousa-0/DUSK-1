// Alert rules on each telemetry line. A rule fires once when it becomes true and
// re-arms when it is false again. Add a rule to RULES; nothing else changes.
import { G0, fx } from './format.js';

export const RULES = [
  { key: 't', test: (m, c) => m.T != null && m.T > c.tMax, text: (m, c) => `Temperature ${fx(m.T, 1)} °C is above ${c.tMax} °C` },
  { key: 'hi', test: (m, c) => m.a != null && m.a > c.aHigh, text: m => `High acceleration ${fx(m.a, 1)} m/s² (${fx(m.a / G0, 1)} g)` },
  { key: 'ff', test: (m, c) => m.a != null && m.a < c.aFree, text: m => `Free fall: |a| ${fx(m.a, 1)} m/s²` },
];

export class AlertMonitor {
  constructor(settings, rules = RULES, now = () => Date.now()) {
    this.settings = settings;
    this.rules = rules;
    this.now = now;
    this.active = {};
  }

  /** Returns the event messages to add for this telemetry line. */
  check(m) {
    const c = this.settings.values, out = [];
    for (const r of this.rules) {
      const on = r.test(m, c);
      if (on && !this.active[r.key]) out.push({ type: 'event', ts: this.now(), sev: 'WARNING', cat: 'ALERT', msg: r.text(m, c) });
      this.active[r.key] = on;
    }
    return out;
  }

  reset() { this.active = {}; }
}
