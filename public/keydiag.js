'use strict';
// TEMPORARY (Android only): what the tablet's Esc really does. Keys, Back (popstate), the page
// going away, sent to the hub's data/keys.log. Remove with its server route when done.
(() => {
  if (/iPhone|iPad|Macintosh/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent)) return; // any other touch device, whatever it calls itself
  if (!(navigator.maxTouchPoints > 0) && !/Android|Linux/i.test(navigator.userAgent)) return;
  const v = (document.querySelector('script[src*="keydiag"]') || {}).src || '';
  const hist = () => ({ len: history.length, state: history.state, hash: location.hash });
  const post = (ev, more) => {
    const body = JSON.stringify({ ev, v: v.replace(/.*v=/, ''), ...hist(), ...more });
    fetch('/api/debug/keys', { method: 'POST', headers: { 'content-type': 'application/json', 'x-herdr-hub': '1' }, body, keepalive: true }).catch(() => {});
  };
  post('boot', { ua: navigator.userAgent, touch: navigator.maxTouchPoints, android: typeof ANDROID !== 'undefined' && ANDROID, standalone: matchMedia('(display-mode: standalone)').matches, fine: matchMedia('(pointer: fine)').matches, active: navigator.userActivation && navigator.userActivation.hasBeenActive });
  for (const t of ['keydown', 'keyup']) {
    document.addEventListener(t, (e) => {
      const target = e.target && (e.target.id || e.target.tagName);
      setTimeout(() => post(t, { key: e.key, code: e.code, keyCode: e.keyCode, composing: e.isComposing, target, prevented: e.defaultPrevented, view: typeof view !== 'undefined' && view.name }), 0);
    }, true);
  }
  window.addEventListener('popstate', () => post('popstate'));
  window.addEventListener('hashchange', () => post('hashchange'));
  document.addEventListener('visibilitychange', () => post('visibility', { state: document.visibilityState }));
  window.addEventListener('pagehide', () => post('pagehide'));
  let first = true;
  document.addEventListener('click', () => first && ((first = false), setTimeout(() => post('first-click', { root: typeof backKey !== 'undefined' && backKey.root }), 50)), true);
})();
