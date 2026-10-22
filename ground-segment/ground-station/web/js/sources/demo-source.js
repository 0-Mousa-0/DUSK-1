// Built-in simulator: a whole mission (pad, launch, parachute descent, landing) that
// repeats every 4 minutes. It speaks the same messages as the real backend.
import { DataSource } from './data-source.js';
import { fx, stamp } from '../core/format.js';
import { emptyStats } from '../core/store.js';

const rnd = a => (Math.random() - .5) * 2 * a;
const BOOT_TEXT = 'boot | reset power-on | mpu ok | dht ok | cam ok | gravity zeroed at start-up';
const BOOT_CONSOLE = ['==========================================================', ' DUSK-1 · telemetry + camera (MPU-6050 + DHT22 + OV2640 + SiK radio)',
  '[1/6] I2C scan on SDA=IO14, SCL=IO15', '      found 0x68   MPU-6050 (AD0 = GND)', '[2/6] MPU-6050 chip ID', '      WHO_AM_I         0x68 at address 0x68       0x68             PASS',
  '[4/6] Still test - do not touch the board or the table for 4 seconds', '      gravity corr.    1.000 g = 9.807 m/s²       9.51 - 10.10     PASS',
  '[5/6] DHT22 on IO13', '      DHT22 read       OK after 1 of 3 tries      valid reading    PASS', '[6/6] Camera OV2640', '      test picture     320x240, 7412 bytes, 61 ms JPEG             PASS'];

export class DemoSource extends DataSource {
  /** drawPicture(profile, id, partial) -> image URL; injected so the simulator runs without a canvas in tests. */
  constructor({ drawPicture } = {}) {
    super('demo', 'DEMO · SIMULATOR');
    this.canCommand = true;                        // commands change the simulator
    this.drawPicture = drawPicture;
    this.timer = null;
  }

  describe() { return 'built-in simulator · no hardware'; }

  async start(sink) {
    this.sink = sink;
    const run = this.run = {};                     // stop() during the import below cancels this start
    if (!this.drawPicture) this.drawPicture = (await import('./demo-scene.js')).drawScene;
    if (this.run !== run) return;
    Object.assign(this, { t0: Date.now(), pkt: 1, img: 0, nextImg: 6, period: 15, size: '320x240', sending: null, lastGs: 0, dhtT: 31, lastT: null, stats: emptyStats() });
    sink({ type: 'link', state: 'LIVE', source: 'built-in simulator', connected: true });
    BOOT_CONSOLE.forEach(text => this.console(text));
    sink({ type: 'boot', t: stamp(Date.now()), text: BOOT_TEXT, fields: { reset: 'power-on', mpu: 'ok', dht: 'ok', cam: 'ok', gravity: 'zeroed at start-up' } });
    this.event('INFO', 'SYSTEM', 'Demo mode: built-in simulator, no hardware connected');
    this.event('INFO', 'BOOT', 'CanSat started: ' + BOOT_TEXT);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop() { this.run = null; clearInterval(this.timer); this.timer = null; }

  event(sev, cat, msg) { this.sink({ type: 'event', ts: Date.now(), sev, cat, msg }); }
  console(text) { this.sink({ type: 'console', text }); }

  /** The simulated flight: what the sensors would read s seconds into the 4-minute mission. */
  profile(s) {
    const P = {}; let h = 0;
    if (s < 60) { P.phase = 'ON THE PAD'; P.a = 9.81 + rnd(.03); P.roll = 1.5 + rnd(.2); P.pitch = -1 + rnd(.2); P.g = [rnd(.3), rnd(.3), rnd(.3)]; }
    else if (s < 63) { P.phase = 'LAUNCH'; P.a = 34 + rnd(6); P.roll = 2 + rnd(2); P.pitch = -2 + rnd(2); P.g = [rnd(25), rnd(25), rnd(40)]; h = (s - 60) * 60; }
    else if (s < 68) { P.phase = 'ASCENT'; P.a = 3 + rnd(1.2); P.roll = 4 + rnd(3); P.pitch = rnd(4); P.g = [rnd(15), rnd(15), rnd(30)]; h = 180 + (s - 63) * 160; }
    else if (s < 70) { P.phase = 'EJECTION'; P.a = .8 + rnd(.5); P.roll = rnd(170); P.pitch = rnd(80); P.g = [rnd(220), rnd(220), rnd(220)]; h = 1000; }
    else if (s < 72) { P.phase = 'PARACHUTE OPENS'; P.a = 24 + rnd(5); P.roll = rnd(40); P.pitch = rnd(30); P.g = [rnd(90), rnd(90), rnd(90)]; h = 990; }
    else if (s < 180) {
      P.phase = 'DESCENT'; const w = 2 * Math.PI; P.a = 9.8 + 1.4 * Math.sin(w * s / 3) + rnd(.4); P.roll = 14 * Math.sin(w * s / 4.3) + rnd(1); P.pitch = 9 * Math.sin(w * s / 5.1 + 1) + rnd(1);
      P.g = [30 * Math.cos(w * s / 4.3) + rnd(4), 20 * Math.cos(w * s / 5.1 + 1) + rnd(4), rnd(12)]; h = 990 * (1 - (s - 72) / 108);
    }
    else if (s < 182) { P.phase = 'LANDING'; P.a = s < 181 ? 36 + rnd(8) : 12 + rnd(3); P.roll = 40 + rnd(30); P.pitch = rnd(20); P.g = [rnd(150), rnd(150), rnd(150)]; }
    else { P.phase = 'LANDED'; P.a = 9.81 + rnd(.03); P.roll = 72 + rnd(.2); P.pitch = 8 + rnd(.2); P.g = [rnd(.3), rnd(.3), rnd(.3)]; }
    const r = P.roll * Math.PI / 180, p = P.pitch * Math.PI / 180;
    P.ax = -Math.sin(p) * P.a; P.ay = Math.sin(r) * Math.cos(p) * P.a; P.az = Math.cos(r) * Math.cos(p) * P.a;
    this.dhtT += (31 - 0.0065 * h - this.dhtT) * 0.08; P.T = this.dhtT + rnd(.05); P.RH = 22 + 0.004 * h + rnd(.2); P.h = h;
    return P;
  }

  tick() {
    const now = Date.now(), s = ((now - this.t0) / 1000) % 240, P = this.profile(s), st = this.stats;
    if (Math.random() < .02) { st.lost++; this.pkt++; this.event('WARNING', 'RF', `Lost 1 line(s) before pkt ${this.pkt} (simulated)`); }
    const m = { type: 'telemetry', t: stamp(now), rx: now, pkt: this.pkt++, T: +P.T.toFixed(1), RH: +P.RH.toFixed(1), ax: +P.ax.toFixed(2), ay: +P.ay.toFixed(2), az: +P.az.toFixed(2),
      a: +P.a.toFixed(2), gx: +P.g[0].toFixed(2), gy: +P.g[1].toFixed(2), gz: +P.g[2].toFixed(2), roll: +P.roll.toFixed(1), pitch: +P.pitch.toFixed(1), n: 100, err: 0, phase: P.phase };
    st.telemetry++; st.lines += 1; this.lastT = m.T;
    this.sink(m);
    if (this.sending) {
      const sd = this.sending; sd.got = Math.min(sd.total, sd.got + 7 + (Math.random() * 2 | 0)); st.lines += 7;
      this.sink({ type: 'img_progress', id: sd.id, got: sd.got, total: sd.total, w: 320, h: 240, bytes: sd.bytes });
      if (sd.got >= sd.total) {
        const partial = Math.random() < .1, url = this.drawPicture(sd.P, sd.id, partial);
        partial ? st.pictures_partial++ : st.pictures_ok++;
        this.sending = null;
        this.sink({ type: 'image', id: sd.id, url, name: `demo_img_${sd.id}.jpg`, w: 320, h: 240, bytes: Math.round(url.length * .75), complete: !partial, missing: partial ? 2 : 0, pieces: sd.total, t: sd.t, rx: now });
        this.event(partial ? 'WARNING' : 'INFO', 'CAMERA', partial ? `Picture ${sd.id} saved with 2 of ${sd.total} pieces missing (simulated)` : `Picture ${sd.id} complete (simulated)`);
      }
    } else if ((now - this.t0) / 1000 >= this.nextImg) {
      this.img++; this.nextImg = (now - this.t0) / 1000 + this.period; const total = 24 + (Math.random() * 16 | 0);
      this.sending = { id: this.img, got: 0, total, bytes: total * 192 - 60, P, t: stamp(now) };
      this.sink({ type: 'img_progress', id: this.img, got: 0, total, w: 320, h: 240, bytes: total * 192 - 60 });
      this.event('INFO', 'CAMERA', `Picture ${this.img} incoming: 320x240, ${total} pieces (simulated)`);
    }
    if (now - this.lastGs > 5000) {
      this.lastGs = now; const up = Math.round((now - this.t0) / 1000);
      this.sink({ type: 'gs', ts: now, fields: { up: String(up), wifi: 'DUSK1-GROUND', ip: '192.168.4.1', laptops: '2', lines: String(st.lines), telemetry: String(st.telemetry), lost: String(st.lost), bad_pieces: '0', pictures: String(st.pictures_ok), wifi_drops: '0' } });
    }
    this.sink({ type: 'link', state: 'LIVE', source: 'built-in simulator', connected: true, age: 0 });
    this.sink({ type: 'stats', ...st });
  }

  async send(text) { return { state: 'SIMULATED', note: this.command(text) }; }

  command(t) {
    const k = t.trim().toLowerCase(), now = Date.now();
    if (k === 'k') { this.nextImg = (now - this.t0) / 1000; this.console('Picture coming'); return 'Picture requested'; }
    if (k === 'i') {
      const L = [10, 15, 30, 60, 0]; this.period = L[(L.indexOf(this.period) + 1) % L.length] || 0;
      if (!this.period) { this.nextImg = 1e12; this.console('Automatic pictures OFF - key k takes one'); return 'Pictures off'; }
      this.nextImg = (now - this.t0) / 1000 + this.period; this.console(`Automatic picture every ${this.period} s`); return `Every ${this.period} s`;
    }
    if (k === 'v') { const L = ['320x240', '640x480', '160x120']; this.size = L[(L.indexOf(this.size) + 1) % 3]; this.console(`Picture size now ${this.size} (bigger = slower over the radio)`); return this.size; }
    if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(t.trim())) { this.console(`Dusk1-${t.trim()}:> clock set`); this.event('INFO', 'COMMAND', `CanSat clock set to ${t.trim()} (simulated)`); return 'Clock set'; }
    if (k === 'c') { ['[4/6] Still test - do not touch the board or the table for 4 seconds', '      gravity corr.    1.000 g = 9.807 m/s²       9.51 - 10.10     PASS', 'RESULT: MPU-6050 OK  (6 passed, 0 warnings)'].forEach(x => this.console(x)); return 'Still test passed'; }
    if (k === 'd') { ['[5/6] DHT22 on IO13', `      temperature      ${fx(this.lastT, 1)} °C                    -40 - 80 °C      PASS`].forEach(x => this.console(x)); return 'DHT22 ok'; }
    if (k === 'h') { this.console('Keys: h help · k picture now · i interval · v size · z gravity fix · c still test · d DHT22 · s I2C scan'); return 'Help shown'; }
    this.console(`Not understood: "${t}" - type h for help`); return 'Not understood';
  }
}
