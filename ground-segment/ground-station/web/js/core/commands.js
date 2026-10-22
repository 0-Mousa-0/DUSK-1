// Commands the operator can send up to the CanSat, and what happened to each one.
import { stamp } from './format.js';

/** Buttons on the Commands tab: [label, text (or a function giving it), primary button?] */
export const PRESETS = [
  ['Take picture now', 'k', true], ['Picture interval', 'i'], ['Picture size', 'v'],
  ['Sync CanSat clock', () => stamp(Date.now())], ['Still test', 'c'], ['DHT22 check', 'd'], ['Help list', 'h']];

export const presetText = p => typeof p[1] === 'function' ? p[1]() : p[1];

export class CommandHistory {
  constructor(limit = 50) {
    this.items = [];
    this.limit = limit;
    this.listeners = new Set();
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  add(text, label) {
    const c = { ts: Date.now(), text, label: label || text, state: 'PENDING', note: '' };
    this.items.unshift(c);
    if (this.items.length > this.limit) this.items.length = this.limit;
    this.changed();
    return c;
  }

  update(c, state, note) {
    c.state = state;
    c.note = note || '';
    this.changed();
  }

  changed() { this.listeners.forEach(fn => fn()); }
}
