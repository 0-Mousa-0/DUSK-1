import { esc, hms } from '../core/format.js';
import { $, onButton } from './dom.js';

const FILTERS = ['ALL', 'INFO', 'WARNING', 'ERROR', 'CAMERA', 'COMMAND', 'ALERT'];

export class LogView {
  constructor(app) {
    this.app = app;
    this.filter = 'ALL';
    onButton($('#lf'), 'f', b => { this.filter = b.dataset.f; this.render(); });
  }

  render() {
    const f = this.filter;
    $('#lf').innerHTML = FILTERS.map(x => `<button class="btn ${f === x ? 'on' : ''}" type="button" data-f="${x}">${x}</button>`).join('');
    const a = this.app.store.events.filter(e => f === 'ALL' || e.sev === f || e.cat === f).slice(-200).reverse();
    $('#evs').innerHTML = a.length ? a.map(e => `<div class="ev"><span>${hms(e.ts)}</span><span class="${esc(e.sev)}">${esc(e.sev)}</span><span>${esc(e.cat)}</span><span>${esc(e.msg)}</span></div>`).join('') : '<div class="empty">No events</div>';
  }
}
