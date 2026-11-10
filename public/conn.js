'use strict';
// 연결: the pure parts of managing hosts (설정 → 연결) and of the way in when the hub is down.
// The page remembers, per device, the hosts it last saw and their own addresses; when the hub
// can't be reached for a while it offers to open a peer that still answers directly. Used by the
// app (app.js, settings.js) and by offline.html, which the service worker serves when the hub's
// page itself can't be loaded. Pure: a plain script in the page (window.Conn), required by tests.
(function (root) {
  const I18n = root.I18n || require('./i18n.js');
  const T = I18n.t;
  const KEY = 'herdr-hub.hosts'; // localStorage: what remember() returns
  const DOWN_MS = 10000; // the stream down this long, and /api/version failing too: the notice
  const PROBE_MS = 3500;

  const ID = /^[a-z][a-z0-9-]{0,31}$/;
  const originOf = (u) => {
    try {
      const x = new URL(String(u || ''));
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.origin : null;
    } catch {
      return null;
    }
  };

  // What to keep from a state: this page's host (its address is the page's origin) and every
  // peer with the address the hub follows it at. Hosts not in the new state are dropped; a peer
  // whose address is unknown (an older hub) keeps the one remembered before.
  // -> { self: { id, label, url, hub }, hosts: [{ id, label, url }], at }
  function remember(prev, origin, state, now = Date.now()) {
    if (!state || !Array.isArray(state.hosts) || !originOf(origin)) return prev || null;
    const before = new Map(((prev && prev.hosts) || []).map((h) => [h.id, h]));
    const hosts = [];
    let self = null;
    for (const h of state.hosts) {
      if (!h || typeof h.id !== 'string') continue;
      const label = String(h.label || h.id);
      if (h.local) {
        self = { id: h.id, label, url: originOf(origin), hub: state.hosts.length > 1 };
        continue;
      }
      const url = originOf(h.url) || (before.get(h.id) || {}).url || null;
      if (url) hosts.push({ id: h.id, label, url });
    }
    if (!self) self = { id: state.hostId || 'local', label: String(state.hostLabel || state.host || ''), url: originOf(origin), hub: hosts.length > 0 };
    return { self, hosts, at: now };
  }

  function read(storage) {
    try {
      const r = JSON.parse(storage.getItem(KEY));
      return r && r.self && Array.isArray(r.hosts) ? r : null;
    } catch {
      return null;
    }
  }
  // Written only when something but the time changed.
  function write(storage, rec) {
    try {
      const old = read(storage);
      if (old && JSON.stringify({ ...old, at: 0 }) === JSON.stringify({ ...rec, at: 0 })) return false;
      storage.setItem(KEY, JSON.stringify(rec));
      return true;
    } catch {
      return false;
    }
  }

  // The hosts to offer when this page's own server can't be reached: every remembered one at
  // another address than this page.
  function candidates(rec, origin) {
    const here = originOf(origin);
    return ((rec && rec.hosts) || []).filter((h) => h.url && h.url !== here);
  }

  // Whether to show the notice: the live stream down for DOWN_MS and /api/version failing too
  // (a deploy's restart comes back within seconds; a 502 from tailscale serve counts as down).
  function hubDown({ downSince, now, versionOk }) {
    return Boolean(downSince) && now - downSince >= DOWN_MS && versionOk === false;
  }

  // What a probe of <url>/api/version from the browser says: answers when it's a Herdr Hub's reply.
  const answers = (status, body) => status === 200 && Boolean(body) && typeof body.version === 'string';

  // Asks each host's /api/version from the browser (cross-origin: the peer allows this one path,
  // lib/hub.js CORS_RULE), all at once, PROBE_MS each. -> the hosts that answered, in their order.
  async function probe(hosts, fetchImpl, timeoutMs = PROBE_MS) {
    const one = async (h) => {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => ctl && ctl.abort(), timeoutMs);
      try {
        const r = await fetchImpl(`${h.url}/api/version`, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: ctl ? ctl.signal : undefined });
        const body = await r.json().catch(() => null);
        return answers(r.status, body);
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    };
    const ok = await Promise.all(hosts.map(one));
    return hosts.filter((h, i) => ok[i]);
  }

  // The notice. rec: remembered (or null); live: the candidates that answered just now;
  // probing: still asking. -> { title, lines, buttons: [{ label, url }], note }
  function notice(rec, { live = [], probing = false } = {}) {
    const self = (rec && rec.self) || {};
    const name = self.label || '';
    const title = self.hub
      ? name
        ? T('허브({name})에 연결할 수 없습니다', { name })
        : T('허브에 연결할 수 없습니다')
      : name
        ? T('{name}에 연결할 수 없습니다', { name })
        : T('이 호스트에 연결할 수 없습니다');
    const lines = [
      T('이 기기의 Tailscale 이 켜져 있는지 확인하세요.'),
      // 「desktop 컴퓨터가」: a Latin name takes no particle well (「desktop가」), the word between does.
      name ? T('켜져 있다면 {name} 컴퓨터가 잠들었거나 Herdr Hub 가 꺼져 있을 수 있습니다.', { name }) : T('켜져 있다면 그 컴퓨터가 잠들었거나 Herdr Hub 가 꺼져 있을 수 있습니다.'),
    ];
    const buttons = live.map((h) => ({ label: T('{name} 로 직접 열기', { name: h.label }), url: h.url, id: h.id }));
    const note = buttons.length
      ? T('직접 열면 다른 주소라 그 호스트의 에이전트만 보이고, 설치한 앱·설정·알림도 따로입니다.')
      : probing
        ? T('다른 호스트에 닿는지 보는 중…')
        : candidates(rec, self.url).length
          ? T('기억한 다른 호스트도 지금은 답하지 않습니다.')
          : '';
    return { title, lines, buttons, note };
  }

  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // The notice's inside (app.js puts it in a bar, offline.html fills its page with it). The title
  // and 다시 시도 share one line; what to check sits in a <details> that the bar folds after a
  // while (open: false), so on a phone it keeps only that line rather than a quarter of the screen.
  function noticeHtml(n, { open = true } = {}) {
    const go = n.buttons.map((b) => `<a class="btn" href="${escape(b.url)}/" data-direct="${escape(b.id)}">${escape(b.label)}</a>`).join('');
    // The note goes with what it is about: beside the direct buttons, else folded with the rest.
    const note = n.note ? `<p class="hd-note" aria-live="polite">${escape(n.note)}</p>` : '';
    return `<div class="hd-body">
        <div class="hd-head"><h2 class="hd-title">${escape(n.title)}</h2><button type="button" class="btn ${go ? 'secondary' : ''}" data-retry>${T('다시 시도')}</button></div>
        <details class="hd-more"${open ? ' open' : ''}><summary>${T('먼저 볼 것')}</summary>${n.lines.map((l) => `<p class="hd-line">${escape(l)}</p>`).join('')}${go ? '' : note}</details>
        ${go ? `<div class="row hd-acts">${go}</div>${note}` : ''}
      </div>`;
  }

  // ---- 설정 → 연결

  // An id for a new host (its routes say it: #/h/<id>/…): the id it gave itself in 연결 시험 (own),
  // else its name when that is one ("server"), else the address's first name
  // ("server.example.ts.net" -> "server"); made unique with -2, -3 ….
  function idFor(name, url, taken = [], own = '') {
    const slug = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^[^a-z]+/, '')
        .replace(/-+$/, '')
        .slice(0, 28);
    let host = '';
    try {
      host = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.split('.')[0];
    } catch {}
    const base = [slug(own), slug(name), slug(host), 'host'].find((s) => ID.test(s) && s !== 'all');
    const used = new Set(taken);
    if (!used.has(base)) return base;
    for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  // 연결 시험's reply (lib/hoststore.js classify) in Korean: { ok, tone: on|warn|bad, text }.
  function testText(r) {
    if (!r) return { ok: false, tone: 'bad', text: T('시험하지 못했습니다.') };
    const herdr = r.herdr === 'up' ? T('herdr 연결됨') : r.herdr ? (r.herdr === 'down' ? T('herdr 꺼짐') : `herdr ${r.herdr}`) : T('herdr 상태 모름');
    switch (r.code) {
      case 'ok': {
        const bits = [T('{name} — Herdr Hub 응답', { name: r.label || r.id || T('호스트') }), herdr, `API ${r.api || T('없음@@inline')}`, r.version ? T('빌드 {version}', { version: r.version }) : ''].filter(Boolean);
        if (r.apiMatch === false) return { ok: true, tone: 'warn', text: T('{bits}. API 가 이 허브와 달라 배포가 필요합니다.', { bits: bits.join(' · ') }) };
        if (r.herdr && r.herdr !== 'up') return { ok: true, tone: 'warn', text: `${bits.join(' · ')}.` };
        return { ok: true, tone: 'on', text: `${bits.join(' · ')}.` };
      }
      case 'self':
        return { ok: false, tone: 'bad', text: T('이 허브 자신의 주소입니다.') };
      case 'timeout':
        return { ok: false, tone: 'bad', text: T('시간 안에 답이 없습니다. 그 컴퓨터가 잠들었거나 Tailscale 이 꺼져 있을 수 있습니다.') };
      case 'dns':
        return { ok: false, tone: 'bad', text: T('그 이름을 찾지 못했습니다(DNS). 주소를 확인하세요.') };
      case 'refused':
        return { ok: false, tone: 'bad', text: T('연결이 거부되었습니다. 포트가 맞는지, Herdr Hub 가 켜져 있는지 확인하세요.') };
      case 'tls':
        return { ok: false, tone: 'bad', text: T('보안 연결(TLS)에 실패했습니다{detail}. https 와 포트를 확인하세요.', { detail: r.detail ? ` (${r.detail})` : '' }) };
      case 'redirect':
        return { ok: false, tone: 'bad', text: T('다른 주소로 넘기려 합니다{location}. 따라가지 않습니다 — 최종 주소를 적어 주세요.', { location: r.location ? ` (${r.location})` : '' }) };
      case 'bad_host':
        return { ok: false, tone: 'bad', text: T('그 호스트가 이 주소 이름을 허용하지 않습니다(403 Host). 그쪽 HERDR_HUB_HOSTS 의 이름으로 적어 주세요.') };
      case 'forbidden':
        return { ok: false, tone: 'bad', text: T('그 호스트가 이 허브를 허용하지 않았습니다(403). 그쪽 HERDR_HUB_ALLOWED_LOGINS 를 확인하세요.') };
      case 'not_hub':
        return { ok: false, tone: 'bad', text: T('답은 오지만 Herdr Hub 가 아닙니다{status}. 포트를 확인하세요.', { status: r.status ? ` (HTTP ${r.status})` : '' }) };
      case 'http':
        return { ok: false, tone: 'bad', text: r.status >= 500 ? T('주소는 답하지만 Herdr Hub 가 꺼져 있는 것 같습니다(HTTP {status}).', { status: r.status }) : T('HTTP {status} 로 답했습니다.', { status: r.status }) };
      default:
        return { ok: false, tone: 'bad', text: T('닿지 못했습니다{detail}.', { detail: r.detail ? ` (${r.detail})` : '' }) };
    }
  }

  const api = { KEY, DOWN_MS, PROBE_MS, originOf, remember, read, write, candidates, hubDown, answers, probe, notice, noticeHtml, idFor, testText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Conn = api;
})(typeof self !== 'undefined' ? self : this);
