'use strict';
// Web push for this device: what 설정's 알림 block says (pushView, pure) and the calls behind its
// buttons (look up, turn on, turn off, test). The hub keeps the endpoints (/api/push/*).
// The top part is pure: window.PushView in the page, required by the tests.

(function (root) {
  // 'ios' | 'android' | 'desktop' (prefs.js, which also keeps a default per platform).
  const platformOf = (ua = '', touchPoints = 0) => (typeof module === 'object' && module.exports ? require('./prefs.js') : root.Prefs).platformOf(ua, touchPoints);

  // Where to allow notifications again once they were refused.
  function deniedFix(platform, standalone) {
    if (platform === 'ios') return 'iPhone 설정 → 알림 → Herdr Hub 에서 허용하세요.';
    if (platform === 'android') return standalone ? '앱 정보(아이콘을 길게 누름) → 알림에서 허용하세요.' : '주소창 왼쪽 사이트 설정 → 알림에서 허용하세요.';
    return '주소창 왼쪽 사이트 설정 → 알림에서 허용하세요.';
  }

  // What the 알림 block shows. env:
  //   platform, standalone (installed app), supported (service worker + PushManager +
  //   Notification), off (this host sends none: HERDR_HUB_PUSH=0), hub (the label of the hub that
  //   follows it, which sends them), alone (no hub follows it: off is this host's own setting),
  //   perm ('default' | 'granted' | 'denied' | 'unsupported'), sub (undefined while looking it
  //   up, else whether the hub knows this device), maxActions (Notification.maxActions).
  // -> { tone: 'on' | 'off' | 'bad' | 'wait', status, lines: [..], actions: ['enable' | 'test' | 'disable'] }
  // The status is one line; lines only say what to do about it. A button only when it can work.
  function pushView(env) {
    const { platform, standalone, supported, off, hub, alone, perm, sub, maxActions } = env;
    if (off && alone) return { tone: 'off', status: '이 호스트는 알림이 꺼져 있습니다', lines: ['HERDR_HUB_PUSH=0 으로 꺼 두었습니다. 알림을 받으려면 그 설정을 빼고 Hub 를 다시 시작하세요.'], actions: [] };
    if (off) return { tone: 'off', status: '이 호스트는 알림을 보내지 않습니다', lines: [`알림은 허브${hub ? `(${hub})` : ''}에서 켜세요.`], actions: [] };
    // iOS has web push only in a home-screen app (Safari itself has no PushManager).
    if (platform === 'ios' && !standalone) return { tone: 'off', status: '설치한 앱에서만 받을 수 있습니다', lines: ['Safari 공유 버튼 → 홈 화면에 추가로 설치한 뒤, 그 앱의 설정에서 켜세요.'], actions: [] };
    if (!supported || perm === 'unsupported') return { tone: 'off', status: '이 브라우저는 알림을 받을 수 없습니다', lines: [], actions: [] };
    if (perm === 'denied') return { tone: 'bad', status: '알림이 거부되어 있습니다', lines: [deniedFix(platform, standalone)], actions: [] };
    if (sub === undefined) return { tone: 'wait', status: '이 기기 알림을 확인하는 중…', lines: [], actions: [] };
    if (sub)
      return {
        tone: 'on',
        status: '이 기기는 알림을 받습니다',
        lines: [Number(maxActions) > 0 ? '답 필요 알림에 Yes · No 같은 답 버튼이 붙습니다(질문이 그대로일 때만 보냄).' : '이 기기의 알림에는 답 버튼이 없습니다. 누르면 그 에이전트가 열립니다.'],
        actions: ['test', 'disable'],
      };
    return {
      tone: 'off',
      status: '이 기기는 알림이 꺼져 있습니다',
      lines: [`에이전트가 답을 기다리거나 일을 끝내면 알려 줍니다.${perm === 'default' ? ' 켜면 권한을 묻습니다.' : ''}`],
      actions: ['enable'],
    };
  }

  const api = { platformOf, deniedFix, pushView };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PushView = api;
})(typeof self !== 'undefined' ? self : this);

// ------------------------------------------------------------ this device's subscription (page)

let pushInfo = null; // /api/push/key; { disabled: true } on a peer that leaves notifications to its hub
// This device's push subscription: undefined until looked up, null when there is none (or the
// hub doesn't know it), else the PushSubscription.
let devSub;
let subAt = 0; // when devSub was last looked up: 설정 shows it at once and looks again after a minute
const SUB_STALE_MS = 60000;
const pushSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isStandalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || Boolean(navigator.standalone);
const devicePlatform = () => PushView.platformOf(navigator.userAgent, navigator.maxTouchPoints || 0);

async function lookupSub() {
  subAt = Date.now();
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return (devSub = null);
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return (devSub = null);
    const r = await api('/push/status', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    devSub = r.subscribed ? sub : null;
  } catch {
    devSub = null;
  }
  return devSub;
}

// The env for pushView from this page, and the lookups it is still missing (each redraws the
// 알림 block when it answers: onPush).
function pushEnv(onPush) {
  const off = Boolean(pushInfo && pushInfo.disabled);
  const supported = pushSupported() && !off;
  if (!pushInfo)
    api('/push/key')
      .then((r) => {
        pushInfo = r;
        if (r.disabled) onPush();
      })
      .catch(() => {});
  if (supported && (devSub === undefined || Date.now() - subAt > SUB_STALE_MS)) lookupSub().then(onPush);
  // A peer that leaves notifications to its hub: the hub that follows it (GET /api/hosts
  // followedBy, settings.js hostAdmin), else the other host it lists (never desktop by name).
  const others = hosts().filter((h) => !h.local);
  const admin = typeof hostAdmin !== 'undefined' ? hostAdmin : null;
  const following = admin && Array.isArray(admin.followedBy) ? admin.followedBy : null;
  return {
    platform: devicePlatform(),
    standalone: isStandalone(),
    supported,
    off,
    hub: following && following.length ? following[0].label : others.length === 1 ? others[0].label : '',
    alone: Boolean(following && !following.length && !others.length),
    perm: 'Notification' in window ? Notification.permission : 'unsupported',
    sub: devSub === undefined ? undefined : Boolean(devSub),
    maxActions: 'Notification' in window ? Number(Notification.maxActions) || 0 : 0,
  };
}

// Only to this device: its own endpoint goes along and the hub sends to that one alone.
async function testPush() {
  const sub = await lookupSub();
  if (!sub) {
    renderPushBlock();
    return toast('이 기기는 알림이 꺼져 있습니다', { action: { label: '알림 켜기', run: enablePush } });
  }
  try {
    await api('/push/test', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    toast('이 기기로 시험 알림을 보냈습니다');
  } catch (err) {
    if (err.code === 'not_subscribed') {
      devSub = null;
      renderPushBlock();
      return toast('이 기기는 알림이 꺼져 있습니다', { action: { label: '알림 켜기', run: enablePush } });
    }
    toastErr(`시험 알림을 보내지 못했습니다: ${errText(err)}`);
  }
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// This device only: the hub forgets its endpoint and the browser drops the subscription; other
// devices keep theirs. 알림 켜기 subscribes again (the permission stays granted).
async function disablePush() {
  const btn = document.getElementById('s-disable');
  if (btn) btn.disabled = true;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    devSub = null;
    toast('이 기기 알림을 껐습니다.');
  } catch (err) {
    toastErr(`알림을 끄지 못했습니다: ${errText(err)}`);
  }
  renderPushBlock();
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      renderPushBlock();
      return toastErr(perm === 'denied' ? `알림이 거부됐습니다. ${PushView.deniedFix(devicePlatform(), isStandalone())}` : '알림 권한을 받지 못했습니다.');
    }
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    devSub = sub;
    toast('이 기기 알림을 켰습니다.');
    renderPushBlock();
  } catch (err) {
    toastErr(`알림을 켜지 못했습니다: ${errText(err)}`);
  }
}
