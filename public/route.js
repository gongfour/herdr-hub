'use strict';
// The app's routes, from the part of the address after #. Every route may carry its host
// (#/h/<id>/…); without one it means the hub's own host (host: null).
//   /agent/<pane>[/screen|/chat]  /term/<pane>  /ws/<id>  /new  /start/(ws|pane)/<id>
//   /settings  and anything else (the old /spaces and 홈 / included): the 작업공간 list.
// Pure: loaded as a plain script in the page (window.Route), required by the tests.
(function (root) {
  function parse(path) {
    let h = path || '/';
    let host = null;
    let m = h.match(/^\/h\/([^/]+)(\/.*)?$/);
    if (m) {
      host = decodeURIComponent(m[1]);
      h = m[2] || '/';
    }
    // An agent always shows its chat. …/screen (the old 화면 tab) opens the terminal sheet over it.
    if ((m = h.match(/^\/agent\/([^/]+)(?:\/(screen|chat))?$/))) return { name: 'agent', host, pane: decodeURIComponent(m[1]), sub: m[2] || null };
    if ((m = h.match(/^\/term\/(.+)$/))) return { name: 'term', host, pane: decodeURIComponent(m[1]) };
    if ((m = h.match(/^\/ws\/(.+)$/))) return { name: 'ws', host, id: decodeURIComponent(m[1]) };
    if (h === '/new') return { name: 'form', host, mode: 'new' };
    if ((m = h.match(/^\/start\/(ws|pane)\/(.+)$/))) return { name: 'form', host, mode: m[1], target: decodeURIComponent(m[2]) };
    if (h === '/settings') return { name: 'settings', host };
    return { name: 'list', host };
  }

  const api = { parse };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Route = api;
})(typeof self !== 'undefined' ? self : this);
