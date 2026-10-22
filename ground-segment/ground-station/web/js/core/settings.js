// Per-viewer settings (mission name, alert limits), kept in this browser only.
const KEY = 'dusk1-gs';
export const DEFAULTS = Object.freeze({ name: 'DUSK-1', team: 'Team Dusk', site: 'Riyadh', tMax: 45, aHigh: 20, aFree: 3 });

function browserStorage() {
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

export class Settings {
  constructor(storage = browserStorage()) {
    this.storage = storage;
    this.values = { ...DEFAULTS };
    try { Object.assign(this.values, JSON.parse((storage && storage.getItem(KEY)) || '{}')); } catch (e) { /* private window */ }
    this.listeners = new Set();
  }

  set(key, value) {
    this.values[key] = value;
    try { if (this.storage) this.storage.setItem(KEY, JSON.stringify(this.values)); } catch (e) { /* not saved, still used */ }
    this.listeners.forEach(fn => fn(key, value));
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
