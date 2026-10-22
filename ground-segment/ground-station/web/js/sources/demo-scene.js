// Demo pictures, drawn in the browser for the simulator only.
export function drawScene(P, id, partial) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d');
  const ph = P.phase; const hz = ph === 'ON THE PAD' ? 140 : ph === 'LAUNCH' || ph === 'ASCENT' ? 205 : ph === 'LANDED' ? 60 : ph === 'LANDING' ? 90 : 70;
  const roll = ph === 'EJECTION' ? P.roll : Math.max(-40, Math.min(40, P.roll)) * (ph === 'LANDED' ? .5 : 1);
  g.save(); g.translate(160, 120); g.rotate(-roll * Math.PI / 180); g.translate(-160, -120);
  const sky = g.createLinearGradient(0, -200, 0, hz); sky.addColorStop(0, '#0f2a5c'); sky.addColorStop(1, ph === 'ON THE PAD' ? '#e9b38a' : '#7fb0e0');
  g.fillStyle = sky; g.fillRect(-200, -200, 720, hz + 200);
  const gr = g.createLinearGradient(0, hz, 0, 440); gr.addColorStop(0, '#b99567'); gr.addColorStop(1, '#6e5236'); g.fillStyle = gr; g.fillRect(-200, hz, 720, 440);
  if (ph === 'DESCENT' || ph === 'PARACHUTE OPENS') {
    for (let i = 0; i < 26; i++) { g.fillStyle = ['#8d9a52', '#a99b6b', '#c7b07c', '#6f8f4e'][i % 4]; g.fillRect(-120 + (i * 53) % 560, hz + 14 + ((i * 37) % 180), 36 + (i % 3) * 14, 10 + (i % 4) * 7); }
    g.fillStyle = '#9aa0a8'; g.fillRect(-200, hz + 60, 720, 3);
  }
  if (ph === 'ON THE PAD') { g.fillStyle = '#e8e2d4'; g.fillRect(152, hz - 70, 6, 90); g.fillStyle = '#ffd6a0'; g.beginPath(); g.arc(250, hz - 36, 14, 0, Math.PI * 2); g.fill(); }
  if (ph === 'LANDED' || ph === 'LANDING') { for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(80,55,30,${.25 + (i % 5) / 10})`; g.fillRect((i * 71) % 330 - 5, hz + (i * 29) % 190, 2 + (i % 3), 2); } }
  if (ph === 'EJECTION') { g.fillStyle = '#ffffff22'; for (let i = 0; i < 6; i++) g.fillRect(-200, i * 40 - 100, 720, 4); }
  g.restore();
  if (partial) { g.fillStyle = '#3a3a3a'; g.fillRect(0, 150, 320, 22); }
  g.fillStyle = '#070B1Fb0'; g.fillRect(0, 218, 320, 22); g.fillStyle = '#E8ECFF'; g.font = '11px IBM Plex Mono, monospace';
  g.fillText(`DEMO · DUSK-1 picture ${id} · ${ph}`, 8, 233);
  return c.toDataURL('image/jpeg', .72);
}
