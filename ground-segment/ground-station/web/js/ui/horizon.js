// Attitude indicator (artificial horizon) as SVG.
import { fx } from '../core/format.js';

export function horizon(roll, pitch) {
  const r = roll || 0, p = Math.max(-45, Math.min(45, pitch || 0));
  const ticks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map(d => `<line x1="100" y1="${d % 30 ? 16 : 12}" x2="100" y2="22" stroke="#8A93C8" stroke-width="${d ? 1.2 : 2}" transform="rotate(${d} 100 100)"/>`).join('');
  const lad = [-30, -20, -10, 10, 20, 30].map(d => `<line x1="${d % 20 ? 86 : 78}" x2="${d % 20 ? 114 : 122}" y1="${100 - d * 2}" y2="${100 - d * 2}" stroke="#E8ECFF" stroke-width="1.2" opacity=".75"/><text x="${d % 20 ? 118 : 126}" y="${103 - d * 2}" font-size="8" fill="#E8ECFF" font-family="IBM Plex Mono,monospace">${Math.abs(d)}</text>`).join('');
  return `<svg viewBox="0 0 200 200" width="200" role="img" aria-label="Attitude indicator: roll ${fx(r, 1)} degrees, pitch ${fx(p, 1)} degrees">
<defs><clipPath id="hzc"><circle cx="100" cy="100" r="80"/></clipPath></defs>
<g clip-path="url(#hzc)"><g transform="rotate(${-r} 100 100) translate(0 ${p * 2})"><rect x="-150" y="-300" width="500" height="400" fill="#1d3f74"/><rect x="-150" y="100" width="500" height="400" fill="#5a3b22"/><line x1="-150" y1="100" x2="350" y2="100" stroke="#E8ECFF" stroke-width="2"/>${lad}</g></g>
<circle cx="100" cy="100" r="80" fill="none" stroke="#2C3470" stroke-width="3"/>${ticks}
<polygon points="100,24 95,33 105,33" fill="#FF8C42" transform="rotate(${-r} 100 100)"/>
<path d="M52 100h32l6 7 10-7 10 7 6-7h32" fill="none" stroke="#FF8C42" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="100" cy="100" r="3" fill="#FF8C42"/></svg>`;
}
