import { esc, hms } from '../core/format.js';
import { $, LINK_COLORS, SOURCE_COLORS, dot } from './dom.js';

export class HeaderView {
  constructor(app) {
    this.app = app;
    $('#modeBtn').addEventListener('click', () => app.nextSource());
  }

  render() {
    const { store, settings, source, sources, sourceIndex } = this.app, L = store.link.state;
    $('#hClock').textContent = hms(Date.now()) + ' local';
    $('#hName').textContent = settings.values.name;
    $('#hPkt').textContent = `pkt ${store.latest ? store.latest.pkt : '—'} · lost ${store.stats.lost || 0}`;
    $('#modeBtn').innerHTML = `${dot(SOURCE_COLORS[source.kind])}${esc(source.label)}`;
    const next = sources[(sourceIndex + 1) % sources.length];
    $('#modeBtn').title = sources.length > 1 ? `Switch to ${next.label.toLowerCase()}` : 'Only this data source is available here';
    $('#hLink').innerHTML = dot(LINK_COLORS[L] || 'mu') + 'LINK · ' + esc(L);
    const cb = $('#tabs [data-t=camera]');
    if (cb) cb.innerHTML = 'Camera' + (this.app.newPics ? `<span class="badge">${this.app.newPics}</span>` : '');
  }
}
