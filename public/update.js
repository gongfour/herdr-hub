'use strict';
// A new deploy: an installed app (iPhone home screen, Galaxy Tab Chrome app) is resumed from
// memory for days instead of loading the page again, so it compares its own version (index.html's
// ?v= of app.js) with the one the server now serves, and reloads by itself when nothing would be
// lost, else offers a banner. These are the pure parts; app.js does the wiring.
// Pure: loaded as a plain script in the page (window.Update), required by the server and the tests.
(function (root) {
  // The app version in an index.html: the ?v= of its app.js (not the icons' own ?v=).
  function versionOf(html) {
    const m = /<script[^>]*\ssrc="[^"]*\/app\.js\?(?:[^"]*&)?v=(\d+)/.exec(String(html || ''));
    return m ? m[1] : '';
  }

  // Whether the server's version is newer than the running one. Unknown on either side: no.
  function newer(mine, theirs) {
    const a = Number(mine);
    const b = Number(theirs);
    return Boolean(mine) && Boolean(theirs) && Number.isFinite(a) && Number.isFinite(b) && b > a;
  }

  // Whether reloading now loses nothing and surprises no one. The page must be on its way back
  // to the foreground (or not on screen at all): an app the user is looking at doesn't change
  // under them. Then: nothing open over the page (a sheet, menu, the switcher, the terminal
  // sheet), no field being typed in, no unsent words or photos in the composer, no message on its
  // way, and no question waiting for typed words.
  function safeToReload(s) {
    return Boolean(s.returning) && !s.layer && !s.typing && !s.composer && !s.sending && !s.answering;
  }

  // The loop guard: once a version has been tried, not again for a while (a reload that came
  // back on the old page, a cached index.html, would otherwise go round).
  const RETRY_MS = 10 * 60 * 1000;
  function mayTry(tried, version, now) {
    return !(tried && tried.v === String(version) && now - Number(tried.t || 0) < RETRY_MS);
  }

  const api = { versionOf, newer, safeToReload, mayTry, RETRY_MS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Update = api;
})(typeof self !== 'undefined' ? self : this);
