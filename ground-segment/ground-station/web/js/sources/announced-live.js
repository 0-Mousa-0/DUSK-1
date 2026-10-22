// The public dashboard's pointer to a live ground station. The backend's --share stores its
// public address and the Pages build writes it to live.json (see dusk1_ground/announce.py).
// findAnnouncedLive() resolves to that address while the ground station answers, else null,
// so a finished session falls back to the recording by itself.
export async function findAnnouncedLive({ fetchImpl = (...a) => globalThis.fetch(...a), pointer = 'live.json', timeoutMs = 5000 } = {}) {
  try {
    const r = await fetchImpl(pointer, { cache: 'no-store' });
    if (!r.ok) return null;
    const url = String((await r.json()).url || '').replace(/\/+$/, '');
    if (!url.startsWith('https://')) return null;
    const state = await fetchImpl(url + '/api/state', { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    return state.ok && (await state.json()).type === 'hello' ? url : null;
  } catch (e) {
    return null;
  }
}
