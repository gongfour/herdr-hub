'use strict';
// A new deploy: an installed app (iPhone home screen, Galaxy Tab Chrome app) is resumed from
// memory for days instead of loading the page again, so it compares the build it was served with
// (index.html's <meta name="herdr-hub-build">, which the server writes in) with the one the
// server now serves, and reloads by itself when nothing would be lost; else a dot on 설정 waits for
// the next safe moment, and only an API change (mustReload) puts a bar at the top.
// These are the pure parts; app.js does the wiring.
// Pure: loaded as a plain script in the page (window.Update), required by the tests.
(function (root) {
  const I18n = root.I18n || require('./i18n.js');
  const T = I18n.t;
  // A build: { version: '1.0.523', commit: 'ae7dc0a', sha, time: ISO, dirty, api, id }.
  // From the meta's content (JSON), or null.
  function parseBuild(text) {
    try {
      const b = JSON.parse(String(text || ''));
      return b && typeof b === 'object' && typeof b.id === 'string' && b.id ? b : null;
    } catch {
      return null;
    }
  }
  const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  // The build in an index.html's text (what a fetch of / brings back), or null.
  function buildOf(html) {
    const m = /<meta\s+name="herdr-hub-build"\s+content="([^"]*)"/.exec(String(html || ''));
    return m ? parseBuild(unescape(m[1])) : null;
  }

  // Whether the server's build is another one than the running one: not "newer", just not the
  // same (a rollback is a new build too). Unknown on either side: no.
  function differs(mine, theirs) {
    return Boolean(mine && mine.id && theirs && theirs.id) && mine.id !== theirs.id;
  }

  const pad = (n) => String(n).padStart(2, '0');
  // "11-05 00:58" in this device's time, or '' when there is none.
  function when(time) {
    const d = new Date(time || NaN);
    return Number.isNaN(d.getTime()) ? '' : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const name = (b) => (b ? `${b.version || 'dev'}${b.dirty ? '+dirty' : ''}` : '');
  // 설정 → 정보: "1.0.523 · 11-05 00:58 · ae7dc0a".
  function buildLabel(b) {
    if (!b) return '';
    return [name(b), when(b.time), b.commit].filter(Boolean).join(' · ');
  }
  // The banner's new build: "1.0.524 (11-05 01:30)".
  function shortLabel(b) {
    if (!b) return '';
    const t = when(b.time);
    return t ? `${name(b)} (${t})` : name(b);
  }

  // Whether reloading now loses nothing and surprises no one. The page must be on its way back
  // to the foreground (or not on screen at all): an app the user is looking at doesn't change
  // under them. Then: nothing open over the page (a sheet, menu, the switcher, the terminal
  // sheet), no field being typed in, no unsent words or photos in the composer, no message on its
  // way, and no question waiting for typed words.
  function safeToReload(s) {
    return Boolean(s.returning) && !s.layer && !s.typing && !s.composer && !s.sending && !s.answering;
  }

  // Away from the page without hiding it: on screen but another window has the focus (Hub left on
  // a monitor while the person works elsewhere), and nothing touched here for a minute. As good as
  // coming back for a reload: no one is reading or typing here. A focused page that is only still
  // (a long output being read) is not away.
  const AWAY_MS = 60 * 1000;
  function away(s) {
    return Boolean(s.visible) && !s.focused && Number(s.idleMs) >= AWAY_MS;
  }

  // Whether this page can't go on as it is: the server speaks another API version (lib/hub.js
  // API_VERSION) than the one this page was written for, so its requests may be wrong. Then the
  // reload doesn't wait for the app to come back, and a bar says so. Any other new build is
  // only a dot on 설정 until the next safe moment. Unknown on either side: no.
  function mustReload(mine, theirs) {
    return differs(mine, theirs) && Number.isInteger(mine.api) && Number.isInteger(theirs.api) && mine.api !== theirs.api;
  }

  // The loop guard: once a build has been tried, not again for a while (a reload that came back
  // on the old page, a cached index.html, would otherwise go round).
  const RETRY_MS = 10 * 60 * 1000;
  function mayTry(tried, id, now) {
    return !(tried && tried.v === String(id) && now - Number(tried.t || 0) < RETRY_MS);
  }

  // A peer on another API version than the hub (an older or newer deploy): what 설정 → 연결 says
  // on its line, e.g. "API 2 (허브는 3)"; '' when they agree, it's offline, or either is unknown.
  function apiNote(host, hub) {
    if (!host || !hub || host.local || !host.online || host.api == null || !Number.isInteger(hub.api) || host.api === hub.api) return '';
    return T('API {api} (허브는 {hub})', { api: host.api || T('없음@@inline'), hub: hub.api });
  }

  const api = { apiNote, parseBuild, buildOf, differs, when, buildLabel, shortLabel, safeToReload, away, AWAY_MS, mustReload, mayTry, RETRY_MS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Update = api;
})(typeof self !== 'undefined' ? self : this);
