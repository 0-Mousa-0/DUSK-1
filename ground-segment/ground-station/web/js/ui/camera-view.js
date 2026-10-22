import { esc, fx, hms } from '../core/format.js';
import { $, kv, onButton } from './dom.js';

const TAGS = { live: ['FROM THE CANSAT', 'g'], replay: ['RECORDED · FROM THE CANSAT', 'g'], demo: ['SIMULATED PICTURES', 'w'] };

export class CameraView {
  constructor(app) {
    this.app = app;
    this.idx = -1;
    this.playing = false;
    this.timer = null;
    this.shown = '';
    this.strip = '';
    const stop = () => this.play(false, true);
    $('#cFirst').onclick = () => { stop(); this.show(0); };
    $('#cPrev').onclick = () => { stop(); this.show(this.idx - 1); };
    $('#cNext').onclick = () => { stop(); this.show(this.idx + 1); };
    $('#cLast').onclick = () => { stop(); this.show(this.images.length - 1); };
    $('#cPlay').onclick = () => this.play(!this.playing);
    $('#cSpeed').onchange = () => { if (this.playing) this.play(true); };
    $('#cSlider').oninput = e => { stop(); this.show(+e.target.value); };
    $('#cFollow').onchange = e => { if (e.target.checked) { stop(); this.show(this.images.length - 1); } };
    onButton($('#strip'), 'pic', b => app.openPicture(+b.dataset.pic));
    document.addEventListener('keydown', e => {
      if (app.act !== 'camera' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'ArrowLeft') { stop(); this.show(this.idx - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { stop(); this.show(this.idx + 1); e.preventDefault(); }
      else if (e.key === ' ') { this.play(!this.playing); e.preventDefault(); }
    });
  }

  get images() { return this.app.store.images; }

  onMessage(m) {
    if (m.type === 'reset') { this.idx = -1; this.play(false, true); }
    if (m.type === 'hello') this.idx = this.images.length - 1;
    if (m.type === 'image' && $('#cFollow').checked && !this.playing) this.idx = this.images.length - 1;
  }

  onShow() { this.strip = ''; }

  /** Picks a picture from a thumbnail: stops playback and following. */
  select(i) { this.play(false, true); this.idx = i; $('#cFollow').checked = false; }

  show(i) {
    if (!this.images.length) return;
    this.idx = Math.max(0, Math.min(this.images.length - 1, i));
    this.render();
  }

  play(on, quiet) {
    this.playing = on;
    clearInterval(this.timer);
    this.timer = null;
    if (on && this.images.length > 1) {
      if (this.idx >= this.images.length - 1) this.idx = 0;
      this.timer = setInterval(() => {
        if (this.idx < this.images.length - 1) this.idx++;
        else if ($('#cLoop').checked) this.idx = 0;
        else { this.play(false); return; }
        this.render();
      }, 1000 / (+$('#cSpeed').value));
    } else this.playing = false;
    if (!quiet) this.render();
  }

  render() {
    const { store, source } = this.app, imgs = store.images, n = imgs.length;
    if (this.idx < 0 && n) this.idx = n - 1;
    const im = n ? imgs[this.idx] : null;
    const [tag, cls] = TAGS[source.kind];
    $('#camTag').textContent = tag; $('#camTag').className = 'tag ' + cls;
    const V = $('#viewer');
    if (!im) { this.shown = ''; V.innerHTML = '<div class="emp">No pictures yet.<br>The CanSat sends one every 15 s.</div>'; }
    else {
      if (this.shown !== im.url) { V.innerHTML = '<img alt=""><div class="ov"></div>'; V.querySelector('img').src = im.url; this.shown = im.url; }
      V.querySelector('img').alt = `Picture ${im.id} from the CanSat camera, ${im.w} by ${im.h}`;
      V.querySelector('.ov').innerHTML = `<span>#${im.id}</span><span>${esc(im.t)}</span><span>${im.w}×${im.h}</span><span style="color:var(--${im.complete ? 'gr' : 'ye'})">${im.complete ? 'COMPLETE' : 'PARTIAL · ' + im.missing + ' missing'}</span>`;
    }
    $('#cSlider').max = Math.max(0, n - 1); $('#cSlider').value = Math.max(0, this.idx); $('#cCount').textContent = `${n ? this.idx + 1 : 0} / ${n}`;
    $('#cPlay').textContent = this.playing ? 'Pause' : 'Play';
    ['#cFirst', '#cPrev', '#cNext', '#cLast', '#cPlay', '#cSlider'].forEach(s => { $(s).disabled = n < 1 || (s === '#cPlay' && n < 2); });
    const pr = store.progress;
    if (pr) {
      $('#progBar').style.width = (pr.total ? pr.got / pr.total * 100 : 0) + '%'; $('#progTag').textContent = 'receiving'; $('#progTag').className = 'tag g';
      $('#progTxt').textContent = `Picture ${pr.id} · ${pr.got} of ${pr.total} pieces · ${pr.w}×${pr.h} · ${fx(pr.bytes / 1024, 1)} kB`;
    } else { $('#progBar').style.width = '0%'; $('#progTag').textContent = 'idle'; $('#progTag').className = 'tag'; $('#progTxt').textContent = 'Waiting for the next picture.'; }
    $('#picKv').innerHTML = im ? kv('Picture', `#${im.id}`) + kv('CanSat time', esc(im.t)) + kv('Received', hms(im.rx)) + kv('Size', `${im.w}×${im.h} · ${fx(im.bytes / 1024, 1)} kB`)
      + kv('Pieces', `${im.pieces - im.missing} of ${im.pieces}`) + kv('Status', im.complete ? 'complete' : 'partial (grey band = missing pieces)') + kv('File', esc(im.name || '—')) : '';
    $('#picNote').textContent = source.kind === 'demo' ? 'Demo pictures are drawn by the simulator in this browser.'
      : source.kind === 'replay' ? 'Pictures from the recorded session, rebuilt by the ground station from the radio pieces.'
      : source.remote ? 'Saved on the ground station laptop.' : `Saved by the backend in dusk1_data/${store.session}/images/.`;
    const key = n + ':' + this.idx;
    if (this.strip !== key) {
      this.strip = key; $('#stripTag').textContent = n + ' picture' + (n === 1 ? '' : 's');
      $('#strip').innerHTML = n ? imgs.map((m, i) => `<button class="th ${i === this.idx ? 'on' : ''}" type="button" data-pic="${i}" aria-label="Show picture ${m.id}"><img loading="lazy" src="${esc(m.url)}" alt=""><span>#${m.id}</span>${m.complete ? '' : '<span class="pt">partial</span>'}</button>`).join('') : '<div class="empty">Pictures appear here as they arrive.</div>';
      const on = $('#strip .th.on'); if (on && this.app.act === 'camera') on.scrollIntoView({ block: 'nearest' });
    }
  }
}
