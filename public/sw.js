'use strict';
// Service worker: shows push notifications, answers from their buttons, and opens the agent
// they point at. No offline copy of the app (it is useless without the host), only one small
// page: when the app's page can't be loaded at all (no network to the host, or tailscale serve's
// 502 while Herdr Hub is down), offline.html says why and offers the other hosts this device
// remembers (conn.js), instead of the browser's error page.

const OFFLINE_CACHE = 'herdr-hub-offline';
const OFFLINE_FILES = ['/offline.html', '/conn.js', '/style.css'];
const REFRESH_MS = 3600e3;
let refreshedAt = 0;
// Fetched again, not from the HTTP cache: a deploy changes them without changing this file.
function cacheOffline() {
  refreshedAt = Date.now();
  return caches.open(OFFLINE_CACHE).then((c) => c.addAll(OFFLINE_FILES.map((u) => new Request(u, { cache: 'no-cache' }))));
}

self.addEventListener('install', (e) => e.waitUntil(cacheOffline().catch(() => {}).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const offlinePage = () => caches.match('/offline.html', { cacheName: OFFLINE_CACHE });
const down = (status) => status === 502 || status === 503 || status === 504;
// A page load: the network as always; offline.html only when that fails. A load that works now
// and then (hourly) refreshes the copy. Nothing else is touched: the API, the stream and every
// asset go straight to the network as before.
async function navigate(e) {
  try {
    const res = await fetch(e.request);
    if (down(res.status)) return (await offlinePage()) || res;
    if (res.ok && Date.now() - refreshedAt > REFRESH_MS) e.waitUntil(cacheOffline().catch(() => {}));
    return res;
  } catch (err) {
    const page = await offlinePage();
    if (page) return page;
    throw err;
  }
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') return e.respondWith(navigate(e));
  // offline.html's own files, asked for by their plain names (the app asks with ?v=).
  if (OFFLINE_FILES.includes(url.pathname) && !url.search && url.pathname !== '/offline.html')
    e.respondWith(fetch(req).catch(() => caches.match(url.pathname, { cacheName: OFFLINE_CACHE }).then((r) => r || Response.error())));
});

// Whether this browser shows notification buttons at all. iOS/iPadOS Safari web push has no
// actions (Notification.maxActions is missing there); Chrome, Edge and Firefox on desktop and
// Android show up to 2.
const maxActions = () => (typeof Notification !== 'undefined' && Number(Notification.maxActions)) || 0;

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Herdr Hub', body: event.data && event.data.text() };
  }
  const actions = maxActions() && Array.isArray(data.actions) ? data.actions.slice(0, maxActions()) : [];
  event.waitUntil(
    self.registration.showNotification(data.title || 'Herdr Hub', {
      body: data.body || '',
      tag: data.tag,
      // 답 필요 alerts again when it replaces an older notification of the same agent; 완료 is quiet.
      renotify: Boolean(data.tag) && (data.renotify ?? true),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      ...(actions.length ? { actions } : {}),
      data: {
        url: data.url || '/',
        kind: data.kind || null,
        host: data.host || null,
        pane: data.pane || null,
        stateSeq: data.stateSeq ?? null,
        answers: data.answers || null,
      },
    })
  );
});

// What an answer request says back, in Korean.
const ANSWER_ERR = {
  stale: '그 질문은 이미 바뀌었습니다',
  not_blocked: '이미 답했거나 더 기다리지 않습니다',
  answered: '이미 답을 보냈습니다',
  needs_text: '이 선택은 앱에서 답을 적어야 합니다',
  agent_not_found: '에이전트가 없습니다',
  peer_offline: '호스트가 오프라인입니다',
};

// A button on a 답 필요 notification: send that option, guarded by stateSeq on the host.
async function answer(note, n) {
  const d = note.data || {};
  const label = d.answers && d.answers[n];
  let ok = false;
  let why = '';
  try {
    const res = await fetch('/api/answer', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Herdr-Hub': '1' },
      body: JSON.stringify({ host: d.host, pane: d.pane, stateSeq: d.stateSeq, n, label: label ?? null }),
    });
    ok = res.ok;
    if (!ok) why = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
  } catch {
    why = 'network';
  }
  // A short confirmation in the same place (same tag), quiet; a failure says what to do.
  await self.registration.showNotification(note.title, {
    body: ok ? `보냄: ${label || n}` : `보내지 못했습니다 — ${ANSWER_ERR[why] || '앱에서 확인하세요'}`,
    tag: note.tag,
    renotify: false,
    silent: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/' },
  });
  // Closed 4 s later, inside the click's waitUntil (this promise): the worker may stop once that ends.
  if (!ok) return;
  await new Promise((r) => setTimeout(r, 4000));
  for (const x of await self.registration.getNotifications({ tag: note.tag })) x.close();
}

// An open app only changes its route (postMessage; the page sets location.hash), so drafts,
// the list position and everything else on the page survive. No window: open one.
function open(url) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (wins) => {
    const w = wins.find((c) => 'focus' in c);
    if (!w) return self.clients.openWindow(url);
    // A page not controlled by this worker may be an older version without the listener.
    if (w.url && new URL(w.url).origin === self.location.origin && 'postMessage' in w) {
      w.postMessage({ type: 'open', url });
      return w.focus();
    }
    if ('navigate' in w) await w.navigate(url);
    return w.focus();
  });
}

self.addEventListener('notificationclick', (event) => {
  const note = event.notification;
  note.close();
  const m = /^answer:([1-9])$/.exec(event.action || '');
  if (m && note.data && note.data.pane) return event.waitUntil(answer(note, Number(m[1])));
  const url = new URL((note.data && note.data.url) || '/', self.location.origin).href;
  event.waitUntil(open(url));
});
