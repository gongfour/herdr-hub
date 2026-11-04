'use strict';
// Android's Back, which a keyboard cover's Esc also becomes (the page may never see the key).
// - The first screen: Back would close the Hub at once. An extra entry under it catches that
//   Back: 「한 번 더 누르면 닫힙니다」, and a second Back within a moment closes it.
// - The shell with a hardware keyboard: Esc belongs to the shell (vim, less), so an extra entry
//   over the shell's turns that Back into Esc. ‹ (✕) and Alt+↑/↓ still leave.
// Entries go in only after the page was touched or typed on: Chrome skips over entries a page
// added before that.

const ANDROID = /Android/i.test(navigator.userAgent);
const touched = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;
const backKey = { root: false, guard: null, escAt: 0, armed: false };

// Under the first screen, once.
function rootGuard() {
  if (!ANDROID || backKey.root || history.length !== 1) return;
  backKey.root = true;
  const st = history.state || {};
  history.replaceState({ ...st, hubRoot: true }, '');
  history.pushState({ prev: st.prev != null ? st.prev : null }, '', location.href);
}
for (const t of ['click', 'keydown', 'touchend']) document.addEventListener(t, () => (rootGuard(), escGuard()), { capture: true, passive: true });

// Over the shell's entry while a hardware keyboard is about (shell.js keyboardLikely).
function escGuard() {
  if (!ANDROID || view.name !== 'term' || !keyboardLikely() || !touched()) return;
  backKey.guard = location.hash;
  if (!(history.state && history.state.escGuard)) history.pushState({ ...(history.state || {}), escGuard: true }, '', location.href);
}
// Whether goBack must step over the guard as well.
const backSteps = () => (history.state && history.state.escGuard ? 2 : 1);

document.addEventListener('keydown', (e) => e.key === 'Escape' && (backKey.escAt = Date.now()), true);
window.addEventListener('popstate', () => {
  const st = history.state || {};
  if (st.hubRoot) {
    // On the extra entry now: the next Back closes the app. A moment later it's guarded again.
    toast('뒤로를 한 번 더 누르면 닫힙니다', { ms: 2000 });
    setTimeout(() => history.state && history.state.hubRoot && history.pushState({ prev: null }, '', location.href), 2000);
    return;
  }
  if (view.name !== 'term' || location.hash !== backKey.guard || st.escGuard) return;
  // Back from the guard, still on the shell: it was Esc (sent already if the key came too).
  const top = topLayer();
  if (top) closeLayer(top);
  else if (Date.now() - backKey.escAt > 600) termEscape();
  history.pushState({ ...st, escGuard: true }, '', location.href);
});
