'use strict';
// The colour someone gave each host (설정 → 연결): { hostId: colour }, kept by the hub
// (data/host-colors.json, lib/hub.js) so every device shows the same, and sent with each host in
// the state (state.hosts[].color). The page tints that host's button in the host segment, its
// cards and its chip with it (style.css [data-hc]); a host not named has none. One of a few soft
// colours, each with a light and a dark value in style.css, never a free one. Pure: a plain script
// in the page (window.HostColor), required by the hub and the tests.
(function (root) {
  const COLORS = ['green', 'teal', 'blue', 'purple', 'pink', 'orange', 'yellow', 'gray'];
  const MAX_HOSTS = 64;
  const ID_MAX = 128;

  const fail = (code) => Object.assign(new Error(code), { status: 400, code });
  const okId = (s) => typeof s === 'string' && s.length > 0 && s.length <= ID_MAX && !/[\u0000-\u001f\u007f]/.test(s);
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

  // What makes sense of a file someone may have edited by hand: the rest left out.
  function clean(raw) {
    const out = {};
    if (!isObj(raw)) return out;
    for (const [h, c] of Object.entries(raw).slice(0, MAX_HOSTS)) if (okId(h) && COLORS.includes(c)) out[h] = c;
    return out;
  }

  // host's colour set, or taken away with '' (or null): a new map, or the same one when nothing
  // changed. known (host ids), when given, is what may stay: a removed host's colour goes. Throws
  // bad_color.
  function set(map, host, color, known = null) {
    if (color != null && color !== '' && !COLORS.includes(color)) throw fail('bad_color');
    const next = {};
    for (const [h, c] of Object.entries(map)) if (h !== host && (!known || known.includes(h))) next[h] = c;
    if (color) next[host] = color;
    const same = Object.keys(next).length === Object.keys(map).length && Object.entries(next).every(([h, c]) => map[h] === c);
    return same ? map : next;
  }

  const api = { COLORS, clean, set };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HostColor = api;
})(typeof self !== 'undefined' ? self : this);
