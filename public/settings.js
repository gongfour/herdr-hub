'use strict';
// 설정: notifications, 리턴 키, 셸 입력, the terminal screen, 화면 모드, 진단, and the hosts.

// ------------------------------------------------------------ settings

let pushInfo = null; // /api/push/key; { disabled: true } on a peer that leaves notifications to its hub
// This device's push subscription: undefined until looked up, null when there is none (or the
// hub doesn't know it), else the PushSubscription.
let devSub;
async function lookupSub() {
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

const PERM_TEXT = {
  granted: ['허용됨', ''],
  denied: ['거부됨', 'iPhone 설정 → 알림 → Herdr Hub 에서 허용하세요.'],
  default: ['아직 묻지 않음', '알림 켜기를 누르면 묻습니다.'],
  unsupported: ['지원 안 됨', '이 브라우저는 알림을 받을 수 없습니다.'],
};

function renderSettings() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const off = pushInfo && pushInfo.disabled;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !off;
  if (!pushInfo)
    api('/push/key')
      .then((r) => {
        pushInfo = r;
        if (settingsShown() && r.disabled) renderSettings();
      })
      .catch(() => {});
  if (devSub === undefined && supported)
    lookupSub().then(() => settingsShown() && renderSettings());
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const [permWord, permTodo] = PERM_TEXT[perm] || [perm, ''];
  const denied = perm === 'denied';
  const subscribed = Boolean(devSub);
  const devLine = !supported || denied ? '' : devSub === undefined ? '이 기기 알림을 확인하는 중…' : subscribed ? '이 기기는 알림을 받습니다.' : '이 기기는 알림이 꺼져 있습니다.';
  listRoot().innerHTML = `
    <header class="bar">
      <h1>설정</h1>
    </header>
    <main class="panel">
      <section>
        <h2>알림</h2>
        <p>에이전트가 답을 기다리거나 작업을 끝내면 알림을 받습니다.</p>
        ${!standalone ? '<p>iPhone에서는 먼저 Safari 공유 버튼 → <b>홈 화면에 추가</b>로 설치한 뒤, 설치된 앱에서 알림을 켜야 합니다.</p>' : ''}
        ${off ? '<p>이 호스트는 알림을 보내지 않습니다. 알림은 허브(desktop)에서 켜세요.</p>' : !supported ? '<p>이 브라우저는 웹 푸시를 지원하지 않습니다.</p>' : ''}
        <p class="perm ${denied ? 'bad' : ''}">권한: <b>${esc(permWord)}</b>${permTodo ? ` — ${esc(permTodo)}` : ''}</p>
        ${devLine ? `<p id="s-dev">${esc(devLine)}</p>` : ''}
        ${supported && !denied ? `<p class="muted">${actionsLine()}</p>` : ''}
        <div class="row">
          ${subscribed
            ? `<button type="button" class="btn" id="s-test">이 기기로 시험 알림</button>
               <button type="button" class="btn secondary" id="s-disable">알림 끄기</button>`
            : `<button type="button" class="btn" id="s-enable" ${supported && !denied ? '' : 'disabled'}>알림 켜기</button>`}
        </div>
      </section>
      <section>
        <h2>리턴 키</h2>
        <div class="seg" role="radiogroup" aria-label="리턴 키" id="s-enter">
          ${[['newline', '줄바꿈'], ['send', '보내기']]
            .map(([k, label]) => `<button type="button" class="toggle" role="radio" data-enter="${k}" aria-checked="${getEnter() === k}" aria-pressed="${getEnter() === k}">${label}</button>`)
            .join('')}
        </div>
        <p>${
          getEnter() === 'send'
            ? '리턴 키로 바로 보냅니다. 키보드가 있으면 Shift+리턴으로 줄을 바꿉니다. iPhone 화면 키보드에는 Shift+리턴이 없어 줄바꿈은 붙여넣기로만 넣을 수 있습니다.'
            : '리턴 키는 줄을 바꿉니다. 보내기는 ↑ 버튼이나 ⌘/Ctrl+리턴입니다.'
        } 에이전트 입력 칸에만 해당하고, 셸 명령 줄은 늘 리턴으로 실행합니다.</p>
      </section>
      <section>
        <h2>셸 입력</h2>
        <div class="seg" role="radiogroup" aria-label="셸 입력" id="s-shell">
          ${[['raw', '키 직접 입력'], ['line', '한 줄 입력']]
            .map(([k, label]) => `<button type="button" class="toggle" role="radio" data-shell="${k}" aria-checked="${getShellInput() === k}" aria-pressed="${getShellInput() === k}">${label}</button>`)
            .join('')}
        </div>
        <p>${
          getShellInput() === 'raw'
            ? '터미널 앱처럼 화면을 탭해 키보드를 올리고, 누르는 키가 바로 셸로 갑니다. 셸의 탭 완성·기록·자동 제안이 그대로 됩니다.'
            : '아래 입력 줄에 명령을 다 쓴 뒤 리턴으로 실행합니다. 한글이나 긴 명령을 쓰기 편합니다.'
        }</p>
      </section>
      <section>
        <h2>터미널 화면</h2>
        <label class="switch"><span>색상</span><input type="checkbox" id="s-color" role="switch" ${getColor() ? 'checked' : ''}></label>
        <label class="switch"><span>셸 줄바꿈</span><input type="checkbox" id="s-wrap-term" role="switch" ${getWrap('term') ? 'checked' : ''}></label>
        <label class="switch"><span>에이전트 화면 줄바꿈</span><input type="checkbox" id="s-wrap-agent" role="switch" ${getWrap('agent') ? 'checked' : ''}></label>
        <p>줄바꿈을 끄면 긴 줄이 한 줄로 남고 옆으로 밀어 봅니다. 표나 전체 화면 프로그램의 모양은 끈 쪽이 지켜집니다.</p>
      </section>
      <section>
        <h2>화면 모드</h2>
        <div class="seg" role="radiogroup" aria-label="화면 모드" id="s-theme">
          ${Object.entries(THEMES)
            .map(([k, label]) => `<button type="button" class="toggle" role="radio" data-theme="${k}" aria-checked="${getTheme() === k}" aria-pressed="${getTheme() === k}">${label}</button>`)
            .join('')}
        </div>
        <p>시스템은 기기의 밝게·어둡게 설정을 따릅니다. 이 기기에만 기억합니다.</p>
      </section>
      <section>
        <h2>호스트</h2>
        ${(hosts().length ? hosts() : [{ id: localId(), label: state.host, online: true, herdr: state.herdr, local: true }])
          .map((x) => {
            const n = state.agents.filter((a) => (a.host || localId()) === x.id).length;
            const status = !x.online ? `오프라인${x.since ? ` · ${esc(clock(x.since))}부터` : ''}` : `herdr ${x.herdr === 'up' ? '연결됨' : esc(x.herdr)} · 에이전트 ${n}개`;
            return `<p><b>${esc(x.label)}</b>${x.local && multi() ? ' (허브)' : ''} · ${status}</p>`;
          })
          .join('')}
      </section>
    </main>${tabBar('settings')}`;
  const radios = (id, attr, set) => {
    document.getElementById(id).onclick = (e) => {
      const b = e.target.closest(`[data-${attr}]`);
      if (!b) return;
      set(b.dataset[attr]);
      for (const x of document.querySelectorAll(`#${id} [data-${attr}]`)) {
        const on = String(x.dataset[attr] === b.dataset[attr]);
        x.setAttribute('aria-checked', on);
        x.setAttribute('aria-pressed', on);
      }
    };
  };
  radios('s-theme', 'theme', setTheme);
  radios('s-shell', 'shell', (v) => {
    setShellInput(v);
    renderSettings();
    document.querySelector(`#s-shell [data-shell="${v}"]`).focus();
  });
  radios('s-enter', 'enter', (v) => {
    setEnter(v);
    renderSettings();
    document.querySelector(`#s-enter [data-enter="${v}"]`).focus();
  });
  document.getElementById('s-color').onchange = (e) => saveColor(e.target.checked);
  document.getElementById('s-wrap-term').onchange = (e) => saveWrap('term', e.target.checked);
  document.getElementById('s-wrap-agent').onchange = (e) => saveWrap('agent', e.target.checked);
  const enable = document.getElementById('s-enable');
  if (enable) enable.onclick = enablePush;
  const test = document.getElementById('s-test');
  if (test) test.onclick = testPush;
  const disable = document.getElementById('s-disable');
  if (disable) disable.onclick = disablePush;
}

// Notification buttons (답 필요 → Yes / No): what this browser says it can show. iOS Safari has
// no Notification.maxActions and shows no buttons; the notification still opens the agent.
function actionsLine() {
  const n = 'Notification' in window ? Number(Notification.maxActions) || 0 : 0;
  return n > 0
    ? '답 필요 알림에 빠른 답 버튼(예: Yes · No)이 붙습니다. 누르면 그 질문이 그대로일 때만 보냅니다.'
    : '이 기기의 알림에는 답 버튼이 없습니다(iPhone 은 지원하지 않음). 알림을 누르면 그 에이전트가 열립니다.';
}

// Only to this device: its own endpoint goes along and the hub sends to that one alone.
async function testPush() {
  const sub = await lookupSub();
  if (!sub) {
    if (settingsShown()) renderSettings();
    return toast('이 기기는 알림이 꺼져 있습니다', { action: { label: '알림 켜기', run: enablePush } });
  }
  try {
    await api('/push/test', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    toast('이 기기로 시험 알림을 보냈습니다');
  } catch (err) {
    if (err.code === 'not_subscribed') {
      devSub = null;
      if (settingsShown()) renderSettings();
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
  if (settingsShown()) renderSettings();
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      if (settingsShown()) renderSettings();
      return toastErr(perm === 'denied' ? '알림이 거부됐습니다. iPhone 설정 → 알림 → Herdr Hub 에서 허용하세요.' : '알림 권한을 받지 못했습니다.');
    }
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    devSub = sub;
    toast('이 기기 알림을 켰습니다.');
    if (settingsShown()) renderSettings();
  } catch (err) {
    toastErr(`알림을 켜지 못했습니다: ${errText(err)}`);
  }
}
