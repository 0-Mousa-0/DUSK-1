import { esc, hms } from '../core/format.js';
import { PRESETS, presetText } from '../core/commands.js';
import { $, onButton } from './dom.js';

const STATE_COLORS = { PENDING: 'ye', SIMULATED: 'cy', FAILED: 'rd', SENT: 'gr' };

export class CommandsView {
  constructor(app) {
    this.app = app;
    onButton($('#cmdBtns'), 'c', b => { const p = PRESETS[+b.dataset.c]; app.sendCommand(presetText(p), p[0]); });
    $('#cmdSend').onclick = () => { const v = $('#cmdText').value.trim(); if (v) { app.sendCommand(v); $('#cmdText').value = ''; } };
    $('#cmdText').onkeydown = e => { if (e.key === 'Enter') $('#cmdSend').click(); };
  }

  /** [note, tag, tag class] for the active source. */
  mode() {
    const s = this.app.source;
    if (s.kind === 'demo') return ['Demo mode: commands only change the simulator. With the backend running they travel laptop → Ground OBC → radio → CanSat.', 'SIMULATED', 'w'];
    if (s.kind === 'replay') return ['Recorded session: commands are not available. On the ground station laptop they travel laptop → Ground OBC → radio → CanSat.', 'READ-ONLY', 'w'];
    if (!s.canCommand) return ['Read-only: you are watching through a shared link. Commands can only be sent from the ground station laptop.', 'READ-ONLY', 'w'];
    return ['Commands reach the CanSat only when its radio TX wire goes to IO3, which is the flight build without the ESP32-CAM-MB base. On the bench the Ground OBC sends them, but the CanSat cannot hear them yet.', 'REAL UPLINK', 'g'];
  }

  render() {
    const [note, tag, cls] = this.mode(), can = this.app.source.canCommand, items = this.app.commands.items;
    $('#cmdNote').textContent = note;
    $('#cmdTag').textContent = tag; $('#cmdTag').className = 'tag ' + cls;
    $('#cmdBtns').innerHTML = PRESETS.map((c, i) => `<button class="btn ${c[2] ? 'pri' : ''}" type="button" data-c="${i}" ${can ? '' : 'disabled'}>${c[0]}</button>`).join('');
    $('#cmdSend').disabled = !can; $('#cmdText').disabled = !can;
    $('#cmdHist').innerHTML = items.length ? items.slice(0, 14).map(c => `<div class="ev" style="grid-template-columns:76px 96px minmax(0,1fr)"><span>${hms(c.ts)}</span><span class="st" style="color:var(--${STATE_COLORS[c.state]})">${c.state}</span><span>${esc(c.label)}${c.label !== c.text ? ' <span style="color:var(--mu)">(' + esc(c.text) + ')</span>' : ''}${c.note ? ' — ' + esc(c.note) : ''}</span></div>`).join('') : '<div class="empty">No commands sent yet</div>';
    const el = $('#console'), atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    el.textContent = this.app.store.console.slice(-200).join('\n') || 'Nothing from the CanSat yet.';
    if (atEnd) el.scrollTop = el.scrollHeight;
  }
}
