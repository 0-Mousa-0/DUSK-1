// Small DOM helpers shared by the views.
export const $ = s => document.querySelector(s);
export const $$ = s => document.querySelectorAll(s);
export const kv = (a, b) => `<div><span>${a}</span><span>${b}</span></div>`;
export const dot = c => `<i class="dot" style="background:var(--${c})"></i>`;
export const LINK_COLORS = { LIVE: 'gr', WAITING: 'ye', CONNECTING: 'ye', 'NO DATA': 'rd', 'BACKEND OFFLINE': 'rd' };
export const SOURCE_COLORS = { live: 'gr', replay: 'cy', demo: 'pu' };

/** Calls handler(button, event) for clicks on buttons inside `container` that have data-<attr>. */
export function onButton(container, attr, handler) {
  container.addEventListener('click', e => {
    const b = e.target.closest(`button[data-${attr}]`);
    if (b && container.contains(b)) handler(b, e);
  });
}
