'use strict';
// Shared by every view: icons, error texts, the page state (state, view, detail) and the
// split layout's roots, host helpers, the host filter and the names for the settings (prefs.js),
// api(), and the layers: sheets, menus, the 단축키 sheet and toasts.

const $app = document.getElementById('app');
const STATUS_LABEL = { blocked: '답 필요', done: '완료', working: '작업 중', idle: '대기', unknown: '알 수 없음' };
const ICON = {
  // Lucide (ISC, lucide.dev) throughout, so stroke, corners and proportions match.
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>', // chevron-left
  gear: '<svg viewBox="0 0 24 24"><path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path d="M16 17v4" /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path d="M8 10v4" /><path d="M8 12H3" /></svg>', // sliders-horizontal
  send: '<svg viewBox="0 0 24 24"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></svg>', // arrow-up
  stop: '<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" /></svg>', // square
  plus: '<svg viewBox="0 0 24 24"><path d="M5 12h14" /><path d="M12 5v14" /></svg>', // plus
  photo: '<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>', // image
  camera: '<svg viewBox="0 0 24 24"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" /><circle cx="12" cy="13" r="3" /></svg>', // camera
  agent: '<svg viewBox="0 0 24 24"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>', // bot
  keyboard: '<svg viewBox="0 0 24 24"><path d="M10 8h.01" /><path d="M12 12h.01" /><path d="M14 8h.01" /><path d="M16 12h.01" /><path d="M18 8h.01" /><path d="M6 8h.01" /><path d="M7 16h10" /><path d="M8 12h.01" /><rect width="20" height="16" x="2" y="4" rx="2" /></svg>',
  keyboardOff: '<svg viewBox="0 0 24 24"><path d="M 20 4 A2 2 0 0 1 22 6" /><path d="M 22 6 L 22 16.41" /><path d="M 7 16 L 16 16" /><path d="M 9.69 4 L 20 4" /><path d="M14 8h.01" /><path d="M18 8h.01" /><path d="m2 2 20 20" /><path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2" /><path d="M6 8h.01" /><path d="M8 12h.01" /></svg>', // keyboard-off
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>', // ellipsis
  term: '<svg viewBox="0 0 24 24"><path d="M12 19h8" /><path d="m4 17 6-6-6-6" /></svg>', // terminal
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>', // x
  folder: '<svg viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>', // folder
  grid: '<svg viewBox="0 0 24 24"><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>', // layout-grid
  file: '<svg viewBox="0 0 24 24"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /></svg>', // file
  panel: '<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></svg>', // panel-left
};
// Logos for herdr agent kinds, from Simple Icons 16.36 (CC0; the marks belong to their owners).
// A kind without one (codex: Simple Icons carries no OpenAI mark) keeps the generic bot.
const KIND_ICON = {
  claude: '<svg class="logo" viewBox="0 0 24 24"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" /></svg>',
  gemini: '<svg class="logo" viewBox="0 0 24 24"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" /></svg>',
  cursor: '<svg class="logo" viewBox="0 0 24 24"><path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" /></svg>',
  copilot: '<svg class="logo" viewBox="0 0 24 24"><path d="M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z" /></svg>',
  cline: '<svg class="logo" viewBox="0 0 24 24"><path d="m23.365 13.556-1.442-2.895V8.994c0-2.764-2.218-5.002-4.954-5.002h-2.464c.178-.367.276-.779.276-1.213A2.77 2.77 0 0 0 12.018 0a2.77 2.77 0 0 0-2.763 2.779c0 .434.098.846.276 1.213H7.067c-2.736 0-4.954 2.238-4.954 5.002v1.667L.64 13.549c-.149.29-.149.636 0 .927l1.472 2.855v1.667C2.113 21.762 4.33 24 7.067 24h9.902c2.736 0 4.954-2.238 4.954-5.002V17.33l1.44-2.865c.143-.286.143-.622.002-.91m-12.854 2.36a2.27 2.27 0 0 1-2.261 2.273 2.27 2.27 0 0 1-2.261-2.273v-4.042A2.27 2.27 0 0 1 8.249 9.6a2.267 2.267 0 0 1 2.262 2.274zm7.285 0a2.27 2.27 0 0 1-2.26 2.273 2.27 2.27 0 0 1-2.262-2.273v-4.042A2.267 2.267 0 0 1 15.535 9.6a2.267 2.267 0 0 1 2.261 2.274z" /></svg>',
  opencode: '<svg class="logo" viewBox="0 0 24 24"><path d="M22 24H2V0h20zM17 4.8H7v14.4h10z" /></svg>',
  kimi: '<svg class="logo" viewBox="0 0 24 24"><path d="m1.053 16.91 9.538 2.55a21 20.981 0 0 0 .06 2.031l5.956 1.592a12 11.99 0 0 1-15.554-6.172m-1.02-5.79 11.352 3.035a21 20.981 0 0 0-.469 2.01l10.817 2.89a12 11.99 0 0 1-1.845 2.004L.658 15.918a12 11.99 0 0 1-.625-4.796m1.593-5.146L13.573 9.17a21 20.981 0 0 0-1.01 1.874l11.297 3.02a21 20.981 0 0 1-.67 2.362l-11.55-3.087L.125 10.26a12 11.99 0 0 1 1.499-4.285ZM6.067 1.58l11.285 3.016a21 20.981 0 0 0-1.688 1.719l7.824 2.091a21 20.981 0 0 1 .513 2.664L2.107 5.218a12 11.99 0 0 1 3.96-3.638M21.68 4.866 7.222 1.003A12 11.99 0 0 1 21.68 4.866" /></svg>',
  qwen: '<svg class="logo" viewBox="0 0 24 24"><path d="M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z" /></svg>',
};
const agentIcon = (a) => KIND_ICON[a.agent] || ICON.agent;
const ERROR_TEXT = {
  cwd_not_absolute: '절대 경로를 적어 주세요.',
  cwd_not_found: '그 폴더가 호스트에 없습니다.',
  cwd_not_directory: '폴더가 아니라 파일입니다.',
  bad_cwd: '폴더 경로가 올바르지 않습니다.',
  bad_kind: '지원하지 않는 에이전트 종류입니다.',
  bad_args: '인자에 쓸 수 없는 문자가 있습니다.',
  bad_agent_name: '이름은 영문 소문자로 시작하고 소문자·숫자·-·_ 만 쓸 수 있습니다(32자까지).',
  bad_label: '이름이 너무 길거나 쓸 수 없는 문자가 있습니다.',
  empty_label: '이름을 적어 주세요.',
  agent_name_taken: '같은 이름의 에이전트가 이미 있습니다.',
  peer_offline: '그 호스트가 오프라인입니다.',
  peer_unreachable: '그 호스트에 닿지 못했습니다.',
  peer_timeout: '그 호스트가 제때 답하지 않았습니다.',
  unknown_host: '모르는 호스트입니다.',
  bad_dir_name: '폴더 이름이 올바르지 않습니다. / \\ : * ? " < > | 와 . 이나 .. 은 쓸 수 없고 100자까지입니다.',
  dir_exists: '같은 이름의 폴더가 이미 있습니다.',
  dir_forbidden: '그 위치에 폴더를 만들 권한이 없습니다.',
  image_too_large: '사진이 너무 큽니다(10MB까지).',
  body_too_large: '사진이 너무 큽니다(10MB까지).',
  bad_image_type: 'JPEG·PNG·WebP 사진만 보낼 수 있습니다.',
  network: '연결이 끊겼습니다. 다시 시도해 주세요.',
  timeout: '응답이 늦어 기다리기를 멈췄습니다. 다시 시도해 주세요.',
  agent_not_found: '에이전트가 끝났거나 닫혔습니다.',
  pane_not_found: '셸이 닫혔습니다.',
  workspace_not_found: '워크스페이스가 닫혔습니다.',
  agent_blocked: '에이전트가 답을 기다리는 중입니다. 위 버튼으로 먼저 답해 주세요.',
  not_subscribed: '이 기기는 알림이 꺼져 있습니다.',
  forbidden: '이 기기는 허용되지 않았습니다.',
};
// Korean for every failure: the server's code, else a plain 'try again' (never "Load failed").
const errText = (err) => ERROR_TEXT[err.code] || (err.status >= 500 ? `호스트 오류(${err.status})입니다. 잠시 뒤에 다시 시도해 주세요.` : err.message && /[가-힣]/.test(err.message) ? err.message : `요청이 실패했습니다${err.code ? ` (${err.code})` : ''}. 다시 시도해 주세요.`);

let state = { agents: [], terminals: [], workspaces: [], hosts: [], herdr: 'connecting' };
let view = { name: 'list' };
let detail = { host: null, pane: null, transcript: null, screen: null, blockedText: null, lastSeq: -1, files: [], sheet: null, activity: null };
const hostCache = new Map(); // host id -> { kinds, recentCwds, platform, home } from that host's /api/host
let pollTimer = null;
let tickTimer = null; // the activity line's clock, once a second while working
let resolveReady;
const ready = new Promise((r) => (resolveReady = r)); // the first state has arrived

// ---- wide screens: the list and the open detail side by side (split.js has the rules)
// Narrower than Split.SPLIT_MIN, #app holds one view at a time as on the phone. Split, it holds
// the rail and two columns: #list-pane (작업공간, always) and #detail-pane (agent, shell,
// workspace, form, 설정, or a calm placeholder). The route is the source of truth for the detail.
const splitMq = matchMedia(`(min-width: ${window.Split ? Split.SPLIT_MIN : 1000}px)`);
let split = false;
const listRoot = () => (split ? document.getElementById('list-pane') : $app);
const detailRoot = () => (split ? document.getElementById('detail-pane') : $app);
// 설정 is the phone's other tab, but split it opens on the right like any detail.
const isDetail = () => view.name !== 'list' && (split || view.name !== 'settings');
// Whether the list (or 설정) is on screen: the list always when split, else only as the view itself.
const listShown = () => split || view.name === 'list';
const settingsShown = () => view.name === 'settings';

// ------------------------------------------------------------ utilities

// A button's shortcut: its title says it ("중단 (Alt+. ×2)"), and data-keyhint is the badge shown
// while Ctrl or Alt is held (app.js, style.css). keymap.js gives the keys, or hint for a key
// its own field handles. Nothing when the action has no key.
const keyAttrs = (action, label, hint) => {
  const h = hint ?? (action ? Keymap.hint(action) : '');
  // An action's own hint follows changed keys (refreshKeyHints); a given one stays.
  const act = action && hint == null ? ` data-keyact="${esc(action)}" data-keylabel="${esc(label)}"` : '';
  return (h ? ` title="${esc(label)} (${esc(h)})" data-keyhint="${esc(h)}"` : '') + act;
};
// After keys change: the buttons on screen say the new ones.
function refreshKeyHints() {
  for (const el of document.querySelectorAll('[data-keyact]')) {
    const h = Keymap.hint(el.dataset.keyact);
    if (h) {
      el.dataset.keyhint = h;
      el.title = `${el.dataset.keylabel} (${h})`;
    } else {
      delete el.dataset.keyhint;
      el.removeAttribute('title');
    }
  }
}

// This device's changed keys (keymap.js setOverrides), laid over the table before anything is
// drawn. Kept as they stand after keymap.js has dropped what can't.
const KEYS_KEY = 'herdr-hub.keys';
let keyOverrides = (() => {
  try {
    return Keymap.setOverrides(JSON.parse(localStorage.getItem(KEYS_KEY)) || {});
  } catch {
    return Keymap.setOverrides({});
  }
})();
function saveKeys(over) {
  keyOverrides = Keymap.setOverrides(over);
  try {
    if (Object.keys(keyOverrides).length) localStorage.setItem(KEYS_KEY, JSON.stringify(keyOverrides));
    else localStorage.removeItem(KEYS_KEY);
  } catch {
    /* this page only */
  }
  refreshKeyHints();
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p || '';

// ------------------------------------------------------------ hosts

// The host a view is about: from the route (#/h/<id>/…), else this Herdr Hub's own host.
const localId = () => state.hostId || null;
const curHost = () => view.host || localId();
const hosts = () => state.hosts || [];
const multi = () => hosts().length > 1;
const hostOf = (id) => hosts().find((h) => h.id === id);
const hostLabel = (id) => (hostOf(id) || {}).label || id || '';
const online = (id) => !hostOf(id) || hostOf(id).online;
// API path for a host: the local host directly, a peer through the hub.
const hp = (path, host = curHost()) => (host && host !== localId() ? `/peers/${encodeURIComponent(host)}${path}` : path);
// Every route carries its host; #/agent/… without one still means the local host.
const link = (host, path) => `#/h/${encodeURIComponent(host || localId() || '')}${path}`;
const same = (x, host, id, key = 'pane') => x[key] === id && (x.host || localId()) === host;
const hostChip = (x) => (multi() ? `<span class="host-chip">${esc(x.hostLabel || hostLabel(x.host))}</span>` : '');
// "hub-pol-d1 · hub-pol-d1" says the same thing twice: one when the folder is named like the workspace.
const wsAndDir = (label, cwd) => {
  const dir = basename(cwd);
  return !dir || dir === label ? label || dir : `${label} · ${dir}`;
};

// Settings saved before the rename lived under paddock.*; move them across once.
try {
  for (const k of Object.keys(localStorage))
    if (k.startsWith('paddock.')) {
      const nk = 'herdr-hub.' + k.slice(8);
      if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k));
      localStorage.removeItem(k);
    }
} catch {}
// 홈 is gone (작업공간 is the one list): the last list tab it kept means nothing now.
try {
  localStorage.removeItem('herdr-hub.tab');
} catch {}

const FILTER_KEY = 'herdr-hub.host';
function getFilter() {
  try {
    return localStorage.getItem(FILTER_KEY) || 'all';
  } catch {
    return 'all';
  }
}
function setFilter(v) {
  try {
    localStorage.setItem(FILTER_KEY, v);
  } catch {
    /* private mode: the choice lasts until reload */
  }
  memFilter = v;
}
let memFilter = getFilter();
// A remembered host that no longer exists falls back to everything.
const filter = () => (memFilter !== 'all' && multi() && hostOf(memFilter) ? memFilter : 'all');
const shown = (x) => filter() === 'all' || (x.host || localId()) === filter();

// The settings themselves are prefs.js's table (Prefs.get / Prefs.set). These names read them.
// 화면 모드: system (no data-theme), light or dark on <html>. index.html applies the saved one
// before first paint; this keeps it, the status bar colour and color-scheme in step.
const THEME_BAR = { light: '#f6f5f1', dark: '#161614' };
const getTheme = () => Prefs.get('theme');
const darkNow = () => {
  const t = getTheme();
  return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
};
function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t;
  else delete root.dataset.theme;
  // Two metas, one per scheme; a forced mode gives both the same colour.
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = /dark/.test(m.media) ? 'dark' : 'light';
    m.content = THEME_BAR[t === 'system' ? scheme : t];
  }
}
applyTheme(getTheme());
// 셸 입력 in the shell view: 'raw' (keys go to the shell as they are pressed) or 'line'.
const getShellInput = () => Prefs.get('shellInput');
// 리턴 키 for the agent composer: 'newline' (send with ↑ or ⌘/Ctrl+Enter) or 'send'.
const getEnter = () => Prefs.get('enter');
// What a change does at once, beyond being stored; the rest is read when next needed.
const PREF_EFFECTS = {
  theme(t) {
    applyTheme(t);
    redrawScreen();
  },
};
function setPref(key, v) {
  Prefs.set(key, v);
  if (PREF_EFFECTS[key]) PREF_EFFECTS[key](v);
}

// iOS takes the focus off the text field when a button is tapped: the keyboard drops, the
// layout jumps under the finger and the tap's click is lost, so 보내기 only closed the keyboard.
// A tap on such a button acts on touchend instead, leaving the focus (and keyboard) in place.
function keepFocusTap(btn, run) {
  let start = null;
  btn.addEventListener('touchstart', (e) => (start = e.touches.length === 1 ? e.touches[0] : null), { passive: true });
  btn.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const from = start;
    start = null;
    if (btn.disabled || !from || !t || Math.hypot(t.clientX - from.clientX, t.clientY - from.clientY) > 12) return;
    e.preventDefault(); // no focus change and no click after it
    run();
  });
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // a mouse keeps the focus too
}

const clock = (t) => (t ? new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '');

async function hostInfo(id) {
  if (!hostCache.has(id)) hostCache.set(id, await api(hp('/host', id)));
  return hostCache.get(id);
}

// Reads give up after 15 s, writes after 60 s: a dead connection after iOS wakes the app must
// not hold up the next poll. Failures carry a code: the server's, else network / timeout.
async function api(path, opts = {}) {
  const write = opts.method && opts.method !== 'GET';
  const signal = opts.signal || (window.AbortSignal && AbortSignal.timeout ? AbortSignal.timeout(write ? 60000 : 15000) : undefined);
  let res;
  try {
    res = await fetch(`/api${path}`, {
      ...opts,
      signal,
      headers: { 'Content-Type': 'application/json', 'X-Herdr-Hub': '1', ...(opts.headers || {}) },
    });
  } catch (err) {
    const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw Object.assign(new Error(timeout ? 'timeout' : 'network'), { code: timeout ? 'timeout' : 'network', network: true });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || body.error || res.statusText), { code: body.error, status: res.status });
  return body;
}

// ---- layers: sheets, menus, the terminal sheet, the photo viewer
// One stack: Escape closes the top one, focus moves into it and comes back afterwards, and
// everything underneath is inert. Sheets slide up, the backdrop fades (not with reduced motion).
const layers = [];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Esc, or Ctrl+[ (the terminal's Esc): a Galaxy Tab's keyboard cover gives its Esc to the system
// (Back) before the page, so a key remapper can turn it into Ctrl+[.
const isEsc = (e) => e.key === 'Escape' || e.key === 'ScrollLock' || (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === '[' || e.code === 'BracketLeft'));
function syncInert() {
  $app.inert = layers.length > 0;
  layers.forEach((l, i) => (l.el.inert = i < layers.length - 1));
}
// Back closes the top layer. Where the browser has CloseWatcher (Chrome 120+: Android's Back, a
// Galaxy Tab cover's Esc, which reaches the page only as Back), each layer gets a watcher: Back
// closes the topmost one and never leaves the page, whatever user activation the page had (Chrome
// skips history entries pushed without one on Back, which is why the entries alone were not
// enough). Closed any other way, its watcher is destroyed. Our own Esc/Ctrl+[ keydown is always
// taken (preventDefault), so a desktop Esc closes one layer, not ours and then the watcher's.
// Elsewhere (iOS Safari: the edge swipe, a browser's back) the fallback is history entries
// (backstack.js): a layer pushes one entry at the same address as it opens; closed any other way
// (Esc, ✕, the backdrop, a choice) its entry is taken back off with history.back(); what the
// closing leads to (onClose: a menu's choice opening the next page or sheet) waits for that, so
// the next entry never lands under the popped one. A route change keeps the entry under the new
// page; Back steps over it there (BackStack.onPop skip). Never both: Back would need two presses.
const watchClose = BackStack.useWatcher(window);
const hist = { pending: 0, after: [], timer: 0, hold: false };
const histDepth = () => {
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i].depth) return layers[i].depth;
  return 0;
};
const histSettled = () => {
  hist.pending = 0;
  clearTimeout(hist.timer);
  const run = hist.after.splice(0);
  run.forEach((f) => f());
};
// Run now, or once our own history.back() calls have come back.
const afterHist = (f) => (hist.pending ? hist.after.push(f) : f());
function pushLayerEntry(layer) {
  if (layer.closed) return;
  const st = history.state || {};
  // An entry of this depth already here (the terminal sheet opened again by relayout): reuse it.
  if (BackStack.depthOf(st) === layer.depth) return;
  history.pushState({ ...st, layer: layer.depth }, '');
}
function popLayerEntry() {
  hist.pending++;
  clearTimeout(hist.timer);
  // A popstate that never comes (the entry was gone already) must not hold the next page up.
  hist.timer = setTimeout(histSettled, 600);
  history.back();
}
function openLayer(el, { onClose, focus, animate = true } = {}) {
  const layer = { el, onClose, back: document.activeElement, closed: false, depth: histDepth() + 1 };
  layers.push(layer);
  if (!animate) el.classList.add('no-anim');
  document.body.appendChild(el);
  syncInert();
  const target = typeof focus === 'string' ? el.querySelector(focus) : focus || el.querySelector('[autofocus], input, [data-k], button');
  if (target) target.focus({ preventScroll: true });
  layer.close = (v) => closeLayer(layer, v);
  if (watchClose) watchLayer(layer);
  else afterHist(() => pushLayerEntry(layer));
  return layer;
}
function watchLayer(layer) {
  try {
    const w = new CloseWatcher();
    w.onclose = () => {
      layer.watcher = null; // spent: Back took it
      closeLayer(layer, undefined, 'watch');
    };
    layer.watcher = w;
  } catch {
    // not fully active (a detached document): Back is simply not caught
  }
}
function unwatchLayer(layer) {
  const w = layer.watcher;
  layer.watcher = null;
  if (w) w.destroy(); // fires nothing
}
// how: 'pop' when Back already took its entry off, 'watch' when Back took its watcher, 'replace' when the caller puts the next page
// in its entry (switcher.js), else its entry is taken back off here, if it is the current one.
function closeLayer(layer, value, how) {
  if (!layer || layer.closed) return;
  layer.closed = true;
  const i = layers.indexOf(layer);
  if (i >= 0) layers.splice(i, 1);
  syncInert();
  const { el } = layer;
  if (reduced() || el.classList.contains('no-anim')) el.remove();
  else {
    el.classList.add('closing');
    el.inert = true;
    setTimeout(() => el.remove(), 160);
  }
  // Back to where focus was, if that is still on the page and not under another layer.
  const back = layer.back;
  if (back && back.isConnected && !back.closest('[inert]') && typeof back.focus === 'function') back.focus({ preventScroll: true });
  unwatchLayer(layer);
  if (!watchClose && !how && !hist.hold && !hist.pending && BackStack.depthOf(history.state) === layer.depth) popLayerEntry();
  if (layer.onClose) afterHist(() => layer.onClose(value));
}
// Back (Android's, the cover's Esc, the browser's, an iOS swipe) onto an entry of a lower depth.
window.addEventListener('popstate', (e) => {
  if (hist.pending) {
    if (--hist.pending === 0) histSettled();
    return;
  }
  const plan = BackStack.onPop(BackStack.depthOf(e.state), histDepth());
  if (plan.close) {
    const to = histDepth() - plan.close;
    while (layers.length && histDepth() > to) closeLayer(topLayer(), undefined, 'pop');
  } else if (plan.skip) history.back();
});
// A reload on a layer's entry: no layer is open, the entry is the page's own now.
if (BackStack.depthOf(history.state)) {
  const { layer, ...st } = history.state;
  history.replaceState(st, '');
}
const topLayer = () => layers[layers.length - 1] || null;

// In-page sheet instead of confirm()/prompt(): those block the page (and automated tests).
// Resolves with the input's value (or true) on OK, null on cancel.
// validate(value) -> a hint while the typed value can't be used ('' when it can): shown under
// the field as you type, and OK waits for a usable value.
function sheet({ title, text = '', error = '', input = null, ok = '확인', danger = false, validate = null, again = false }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet-back';
    el.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        ${text ? `<p>${esc(text)}</p>` : ''}
        ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
        ${input ? `<input class="field" name="v" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="sheet-hint">
        <p class="hint" id="sheet-hint" aria-live="polite"></p>` : ''}
        <div class="row end">
          <button type="button" class="btn secondary" data-cancel>취소</button>
          <button type="submit" class="btn ${danger ? 'danger' : ''}">${esc(ok)}</button>
        </div>
      </form>`;
    const field = el.querySelector('input');
    const submit = el.querySelector('[type=submit]');
    const check = () => {
      if (!validate || !field) return true;
      const hint = validate(field.value);
      el.querySelector('.hint').textContent = hint || '';
      field.setAttribute('aria-invalid', String(Boolean(hint)));
      submit.disabled = Boolean(hint);
      return !hint;
    };
    let layer = null;
    const done = (v) => closeLayer(layer, v);
    // A block body: an onclick that returns false would cancel the submit button's click.
    el.onclick = (e) => {
      if (e.target === el) done(null);
    };
    el.querySelector('[data-cancel]').onclick = () => done(null);
    if (field) field.oninput = check;
    el.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      if (!check()) return;
      done(input ? field.value : true);
    };
    check();
    // Shown again after an error: no slide, so it reads as the same sheet.
    layer = openLayer(el, { onClose: (v) => resolve(v === undefined ? null : v), focus: field || submit, animate: !again });
  });
}

// Ask, post, and on failure ask again with the error and the typed text kept (the 새 폴더 way).
async function askLoop(opts, post) {
  let value = opts.input ? opts.input.value || '' : '';
  let error = '';
  for (let n = 0; ; n++) {
    const v = await sheet({ ...opts, error, again: n > 0, input: opts.input ? { ...opts.input, value } : null });
    if (v == null) return null;
    value = v;
    try {
      return (await post(v.trim())) || true;
    } catch (err) {
      error = errText(err);
    }
  }
}

// A list of actions in a sheet. Resolves with the chosen key or null.
// items: [key, label, danger?, sub?]; a null item is skipped. Danger items go last, under a gap.
function menu(title, items, { sub = '' } = {}) {
  return new Promise((resolve) => {
    const list = items.filter(Boolean);
    const row = ([key, label, danger, note]) =>
      `<button class="action ${danger ? 'danger' : ''}" data-k="${esc(key)}">${esc(label)}${note ? `<span class="sub">${esc(note)}</span>` : ''}</button>`;
    const plain = list.filter((x) => !x[2]);
    const risky = list.filter((x) => x[2]);
    const el = document.createElement('div');
    el.className = 'sheet-back';
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h2>
        ${plain.length ? `<div class="actions">${plain.map(row).join('')}</div>` : ''}
        ${risky.length ? `<div class="actions">${risky.map(row).join('')}</div>` : ''}
        <button class="btn secondary wide" data-k="">취소</button>
      </div>`;
    let layer = null;
    const done = (v) => closeLayer(layer, v);
    // A block body: an onclick that returns false would cancel the submit button's click.
    el.onclick = (e) => {
      if (e.target === el) done(null);
    };
    el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => done(b.dataset.k)));
    layer = openLayer(el, { onClose: (v) => resolve(v || null), focus: '.action' });
  });
}

// Toasts stack above the composer (newest at the bottom, three at most); the same text again
// replaces the old one. Errors are announced at once (role=alert), the rest politely.
// action: { label, run } adds a button (다시 보내기).
let toastBox = null;
function toast(text, { error = false, action = null, ms } = {}) {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    document.body.appendChild(toastBox);
  }
  for (const old of toastBox.querySelectorAll('.toast')) if (old.dataset.text === text) old.remove();
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`;
  el.setAttribute('role', error ? 'alert' : 'status');
  el.dataset.text = text;
  el.innerHTML = `<span class="t">${esc(text)}</span>${action ? `<button type="button" class="t-act">${esc(action.label)}</button>` : ''}`;
  const remove = () => {
    if (!el.isConnected) return;
    if (reduced()) return el.remove();
    el.classList.add('closing');
    setTimeout(() => el.remove(), 160);
  };
  if (action)
    el.querySelector('.t-act').onclick = () => {
      remove();
      action.run();
    };
  toastBox.appendChild(el);
  const all = toastBox.querySelectorAll('.toast:not(.closing)');
  for (let i = 0; i < all.length - 3; i++) all[i].remove();
  setTimeout(remove, ms || (action ? 6000 : error ? 4500 : 3200));
}
const toastErr = (text, action) => toast(text, { error: true, action });
