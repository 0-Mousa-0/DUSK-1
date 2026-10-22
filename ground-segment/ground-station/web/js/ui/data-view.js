import { esc, fx } from '../core/format.js';
import { $ } from './dom.js';

export const COLUMNS = [['t', 'CanSat time'], ['pkt', 'pkt'], ['T', 'T °C'], ['RH', 'RH %'], ['ax', 'ax'], ['ay', 'ay'], ['az', 'az'], ['a', '|a| m/s²'], ['gx', 'gx'], ['gy', 'gy'], ['gz', 'gz'], ['roll', 'roll °'], ['pitch', 'pitch °'], ['n', 'n'], ['err', 'err']];
const decimals = k => ['pkt', 'n', 'err'].includes(k) ? 0 : ['T', 'RH', 'roll', 'pitch'].includes(k) ? 1 : 2;

/** The telemetry on screen as CSV text (same columns as the table). */
export function toCsv(rows) {
  return 'cansat_time,pkt,T,RH,ax,ay,az,|a|,gx,gy,gz,roll,pitch,n,err\n'
    + rows.map(r => COLUMNS.map(([k]) => k === 't' ? r.t : (r[k] == null ? '' : r[k])).join(',')).join('\n');
}

export class DataView {
  constructor(app) {
    this.app = app;
    $('#csvBtn').onclick = () => { $('#csvT').value = toCsv(app.store.tele); $('#csvM').textContent = app.store.tele.length + ' rows'; $('#csvd').showModal(); };
    $('#csvX').onclick = () => $('#csvd').close();
    $('#csvCp').onclick = async () => {
      try { await navigator.clipboard.writeText(toCsv(app.store.tele)); $('#csvM').textContent = 'Copied.'; }
      catch (e) { $('#csvT').select(); $('#csvM').textContent = 'Selected: press Ctrl+C to copy.'; }
    };
  }

  render() {
    const { store, source } = this.app, url = source.csvUrl();
    $('#rowTag').textContent = store.tele.length + ' rows';
    $('#csvLink').hidden = !url;
    if (url) $('#csvLink').href = url;
    const rows = store.tele.slice(-300).reverse();
    $('#tbl').innerHTML = rows.length ? `<table><tr>${COLUMNS.map(c => `<th>${c[1]}</th>`).join('')}</tr>${rows.map(r => `<tr>${COLUMNS.map(([k]) => `<td>${k === 't' ? esc(r.t) : fx(r[k], decimals(k))}</td>`).join('')}</tr>`).join('')}</table>` : '<div class="empty">No telemetry yet</div>';
  }
}
