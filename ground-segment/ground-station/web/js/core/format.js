// Pure formatting helpers. No DOM, no state.
export const G0 = 9.80665;                       // standard gravity, m/s² per g

export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const p2 = n => String(n).padStart(2, '0');
export const hms = t => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); };
export const stamp = t => { const d = new Date(t); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + hms(t); };
export const ago = s => s == null ? 'never' : s < 1.5 ? 'now' : s < 60 ? Math.round(s) + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago';
export const fx = (v, d) => v == null || isNaN(v) ? '—' : (+v).toFixed(d);
