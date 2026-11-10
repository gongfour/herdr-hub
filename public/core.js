'use strict';
// Shared by every view: icons, error texts, the page state (state, view, detail) and the
// split layout's roots, host helpers, the host filter and the names for the settings (prefs.js),
// api(), and the layers: sheets, menus, the 단축키 sheet and toasts.

const $app = document.getElementById('app');
const STATUS_LABEL = { blocked: '답 필요', menu: '메뉴 열림', done: '완료', working: '작업 중', idle: '쉬는 중', unknown: '알 수 없음', stale: '오프라인' };
// 답 필요 that waits for someone, and the status as shown: a menu is 「메뉴 열림」 (rowtext.js).
const { needsAnswer, shownStatus } = RowText;
const ICON = {
  // Lucide (ISC, lucide.dev) throughout, so stroke, corners and proportions match.
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>', // chevron-left
  gear: '<svg viewBox="0 0 24 24"><path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path d="M16 17v4" /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path d="M8 10v4" /><path d="M8 12H3" /></svg>', // sliders-horizontal
  send: '<svg viewBox="0 0 24 24"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></svg>', // arrow-up
  stop: '<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" /></svg>', // square
  plus: '<svg viewBox="0 0 24 24"><path d="M5 12h14" /><path d="M12 5v14" /></svg>', // plus
  photo: '<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>', // image
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
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>', // check
  grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="19" r="1" /></svg>', // grip-vertical
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
  dialog_open: '선택 창이 열려 있습니다 — 먼저 답하거나 Esc 를 보내 주세요. 글은 그대로 있습니다.',
  not_subscribed: '이 기기는 알림이 꺼져 있습니다.',
  forbidden: '이 기기는 허용되지 않았습니다.',
  bad_url: 'https://이름:포트 꼴의 주소만 됩니다(경로·로그인 없이).',
  bad_host_id: '호스트 id 가 올바르지 않습니다.',
  host_is_self: '이 허브 자신입니다.',
  host_id_taken: '같은 id 의 호스트가 이미 있습니다.',
  host_url_taken: '그 주소의 호스트가 이미 있습니다.',
  too_many_hosts: '호스트는 16개까지입니다.',
  not_hub: '이 호스트는 허브가 아니라서 호스트 목록을 바꿀 수 없습니다.',
  not_claude: 'Claude 에이전트에서만 됩니다.',
  input_busy: 'Claude Code 입력 칸에 글이 있어 손대지 않았습니다. 터미널에서 비운 뒤 다시 해 주세요. 메시지는 그대로 대기 중입니다.',
  images_queued: '함께 대기 중인 메시지에 사진이 있어 다시 넣으면 사진이 빠집니다. 메시지는 그대로 대기 중입니다.',
  unsure: '대기 중인 메시지가 Claude Code 입력 칸으로 돌아왔지만 정리하지 못했습니다. 터미널에서 입력 칸을 확인해 주세요(보내지도 지우지도 않았습니다).',
};
// Korean for every failure: the server's code, else a plain 'try again' (never "Load failed").
const errText = (err) => ERROR_TEXT[err.code] || (err.status >= 500 ? `호스트 오류(${err.status})입니다. 잠시 뒤에 다시 시도해 주세요.` : err.message && /[가-힣]/.test(err.message) ? err.message : `요청이 실패했습니다${err.code ? ` (${err.code})` : ''}. 다시 시도해 주세요.`);

let state = { agents: [], terminals: [], workspaces: [], hosts: [], herdr: 'connecting' };
let view = { name: 'list' };
let detail = { host: null, pane: null, transcript: null, screen: null, blockedText: null, lastSeq: -1, files: [], sheet: null, activity: null };
const hostCache = new Map(); // host id -> { kinds, recentCwds, platform, home } from that host's /api/host
let updateReady = false; // the server serves another build than this page's (app.js markUpdate): a dot on 설정
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

// A button's shortcut: its title says it ("중단 (Alt+. ×2)"). keymap.js gives the keys that work here
// (the shell view takes other keys than the rest: Keymap.hint's ctx), or hint for a key its own
// field handles. Nothing when the action has no key here.
const hintCtx = () => ({ shell: view.name === 'term', split });
const keyAttrs = (action, label, hint) => {
  const h = hint ?? (action ? Keymap.hint(action, hintCtx()) : '');
  // An action's own hint follows changed keys and the view (refreshKeyHints); a given one stays.
  const act = action && hint == null ? ` data-keyact="${esc(action)}" data-keylabel="${esc(label)}"` : '';
  return (h ? ` title="${esc(label)} (${esc(h)})"` : act ? ` title="${esc(label)}"` : '') + act;
};
// After keys change, or the view changes (into or out of the shell): the buttons on screen say the
// keys that work now.
function refreshKeyHints() {
  const ctx = hintCtx();
  for (const el of document.querySelectorAll('[data-keyact]')) {
    const h = Keymap.hint(el.dataset.keyact, ctx);
    el.title = h ? `${el.dataset.keylabel} (${h})` : el.dataset.keylabel;
  }
}

// The device the keymap is built for (keymap.js setEnv): a Mac (⌘; an iPad with a keyboard
// too), and the installed app, where the browser's tab and window keys (Ctrl+W, ⌘N …) come to
// the page first. Not display-mode fullscreen: a tab in F11 says that too. A window that turns
// into the app (or back) redraws its key hints.
const KEY_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const appMq = matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui)');
const keyEnv = () => ({ mac: KEY_MAC, app: appMq.matches || Boolean(navigator.standalone) });
Keymap.setEnv(keyEnv());
appMq.addEventListener('change', () => {
  Keymap.setEnv(keyEnv());
  refreshKeyHints();
  if (view.name === 'keys') drawKeysList(); // keyspage.js
});

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
// A peer on another API version than the hub: the note for its line (update.js), or ''.
const apiMismatch = (x) => Update.apiNote(x, hosts().find((h) => h.local));
const hostOf = (id) => hosts().find((h) => h.id === id);
const hostLabel = (id) => (hostOf(id) || {}).label || id || '';
const online = (id) => !hostOf(id) || hostOf(id).online;
// API path for a host: the local host directly, a peer through the hub.
const hp = (path, host = curHost()) => (host && host !== localId() ? `/peers/${encodeURIComponent(host)}${path}` : path);
// Every route carries its host; #/agent/… without one still means the local host.
const link = (host, path) => `#/h/${encodeURIComponent(host || localId() || '')}${path}`;
const same = (x, host, id, key = 'pane') => x[key] === id && (x.host || localId()) === host;
const hostChip = (x) => (multi() ? `<span class="host-chip">${esc(x.hostLabel || hostLabel(x.host))}</span>` : '');
// An agent's or shell's header: its workspace and its folder (the workspace has none of its own),
// the folder as its last two ("…/Project/herdr-hub", rowtext.js shortPath; the whole path is the
// header's tooltip). "hub-pol-d1 · hub-pol-d1" says the same thing twice: one when the folder is
// named like the workspace.
const wsAndDir = (label, cwd) => {
  const dir = RowText.shortPath(cwd, label);
  return !dir ? label || basename(cwd) : `${label} · ${dir}`;
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
const filter = () => peekFilter || (memFilter !== 'all' && multi() && hostOf(memFilter) ? memFilter : 'all');
// fn() as if host f were chosen (tabswipe.js draws the neighbour host's list with it).
let peekFilter = null;
function withFilter(f, fn) {
  const was = peekFilter;
  peekFilter = f;
  try {
    return fn();
  } finally {
    peekFilter = was;
  }
}
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
  // The screen box open now (shell view, agent screen) follows 줄바꿈 and 색상 at once.
  'wrap.term': () => applyScreenPrefs(),
  'wrap.agent': () => applyScreenPrefs(),
  color: () => applyScreenPrefs(),
  termFont: (v) => applyTermFont(v),
  // The shell view open now switches between 키 직접 입력 and 한 줄 입력 in place.
  shellInput(v) {
    if (view.name === 'term' && detail.setRaw) detail.setRaw(v === 'raw');
  },
  shellPredict: () => predRender(), // shell.js
  chatW: (v) => applyChatWidth(v),
  listW() {
    applyListWidth();
    if (split) syncGrip(), hostSegEdges(); // app.js, list.js
  },
};
// 셸 글자 크기: the shell view's screen box (style.css .screen.term) reads --term-font.
function applyTermFont(v = Prefs.get('termFont')) {
  document.documentElement.style.setProperty('--term-font', `${Number(v) || 12}px`);
}
applyTermFont();
// 대화 폭 (prefs.js chatW): style.css picks the chat column from :root[data-chatw].
function applyChatWidth(v = Prefs.get('chatW')) {
  document.documentElement.dataset.chatw = v;
}
applyChatWidth();
// 목록 칸 폭 (prefs.js listW): a set width overrides style.css's 자동 (--list-w-set).
function applyListWidth(px = Prefs.listWidth(Prefs.get('listW'))) {
  const st = document.documentElement.style;
  if (px) st.setProperty('--list-w-set', `${Math.round(px)}px`);
  else st.removeProperty('--list-w-set');
}
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
  // Something sent to an agent started here: its close asks first from now on (quick.js).
  const usedKey = write && Quick.usedBy(path, localId());
  if (usedKey) Quick.used(usedKey);
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
  if (!res.ok) throw Object.assign(new Error(body.message || body.error || res.statusText), { code: body.error, status: res.status, body });
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
// cancel: null for a sheet that only tells something (one button).
// danger: a step that can't be undone. 취소 has the focus, so a habitual Enter keeps things; Ctrl+Enter
// (⌘+Enter), or the key that asked (key: keymap.js's action, Alt+W again), confirms. Those keys
// are the confirm button's (its tooltip, aria-keyshortcuts, and a quiet keycap of the key that
// asked, with a keyboard), not a line of their own.
// subject: what it is about (a name), at the head of the title in its own weight: 「‘hub-qtest’ 에이전트를 끝낼까요?」.
// rows: [[name, value, note]] above the text, for a sheet that tells numbers (사용량).
function sheet({ title, subject = '', rows = null, text = '', error = '', input = null, ok = '확인', cancel = '취소', danger = false, validate = null, again = false, key = null }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    // Split, a dialog about what is open on the right sits over the right column; one asked from the
    // list stays in the middle of the screen (the list's column is too narrow for it).
    const from = document.activeElement && document.activeElement !== document.body ? document.activeElement : lastPointer.el;
    el.className = `sheet-back${split && !(from && from.closest && from.closest('#list-pane')) ? ' in-detail' : ''}`;
    // The text is the dialog's description (「되돌릴 수 없습니다」 is heard, not only the title). The
    // field comes with its old value picked, so typing replaces it, and an ⓧ that empties it (iOS has
    // no select-all-and-delete in reach).
    const name = subject ? clipName(subject, 48) : '';
    const confirm = danger && cancel ? confirmKeys(key) : null;
    el.innerHTML = `<form class="sheet dialog" role="dialog" aria-modal="true" aria-label="${esc(name ? `‘${name}’ ${title}` : title)}"${text ? ' aria-describedby="sheet-text"' : ''} tabindex="-1">
        <h2>${name ? `<span class="sheet-subject">‘${esc(name)}’</span> ` : ''}${esc(title)}</h2>
        ${rows && rows.length ? `<dl class="sheet-rows">${rows.map(([k, v, n]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}${n ? `<span class="sub">${esc(n)}</span>` : ''}</dd></div>`).join('')}</dl>` : ''}
        ${text ? `<p id="sheet-text">${esc(text)}</p>` : ''}
        ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
        ${input ? `<div class="field-wrap"><input class="field" name="v" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="sheet-hint">
        <button type="button" class="field-clear" data-clear aria-label="지우기"${input.value ? '' : ' hidden'}>${ICON.x}</button></div>
        <p class="hint" id="sheet-hint" aria-live="polite"></p>` : ''}
        <div class="row end sheet-btns">
          ${cancel ? `<button type="button" class="btn secondary" data-cancel>${esc(cancel)}</button>` : ''}
          <button type="submit" class="btn ${danger ? 'danger' : ''}"${confirm ? ` title="${esc(confirm.title)}" aria-keyshortcuts="${esc(confirm.aria)}"` : ''}>${esc(ok)}${confirm && confirm.cap && keyboardLikely() ? `<kbd class="btn-key" aria-hidden="true">${esc(confirm.cap)}</kbd>` : ''}</button>
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
    const first = field ? field.value : '';
    // A block body: an onclick that returns false would cancel the submit button's click.
    // A tap beside the sheet closes it, but not once something was typed: a slip would lose it
    // (취소, Esc and Back still do).
    el.onclick = (e) => {
      if (e.target === el && !(field && field.value !== first)) done(null);
    };
    if (cancel) el.querySelector('[data-cancel]').onclick = () => done(null);
    const clear = el.querySelector('[data-clear]');
    if (field)
      field.oninput = () => {
        clear.hidden = !field.value;
        check();
      };
    if (clear)
      clear.onclick = () => {
        field.value = '';
        clear.hidden = true;
        check();
        field.focus();
      };
    el.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      if (!check()) return;
      done(input ? field.value : true);
    };
    if (danger && cancel)
      el.addEventListener('keydown', (e) => {
        const same = key && Keymap.match(e, { shell: view.name === 'term' })?.action === key;
        if (!(((e.ctrlKey || e.metaKey) && e.key === 'Enter') || same) || e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        submit.click();
      });
    check();
    // Shown again after an error: no slide, so it reads as the same sheet.
    // The OK button takes Enter when it came from a key; after a tap it would only look picked.
    // A danger sheet gives Enter to 취소 instead (above).
    const first0 = danger && cancel ? el.querySelector('[data-cancel]') : submit;
    layer = openLayer(el, { onClose: (v) => resolve(v === undefined ? null : v), focus: field || (lastInput === 'key' ? first0 : el.querySelector('.sheet')), animate: !again });
    // Shown again after an error, the typed text stays as it was (the cursor at its end).
    if (field && !again && field.value) field.select();
  });
}

// The keys that confirm a danger sheet: the key that asked (Alt+W, the shell view's Ctrl+Alt+W)
// again, and Ctrl+리턴 (⌘+리턴 on the Mac). cap: the one keycap the button shows (the key that
// asked, else none: Ctrl+리턴 is the same in every danger sheet and said in its tooltip).
function confirmKeys(action) {
  const again = action ? Keymap.hint(action, { shell: view.name === 'term' }) : '';
  const enter = Keymap.deviceKey('Ctrl+Enter');
  const aria = (k) => k.replace(/\bCtrl\b/g, 'Control').replace(/⌘/g, 'Meta').replace(/리턴/g, 'Enter');
  const keys = [again, Keymap.label(enter)].filter(Boolean);
  return { title: `확인: ${keys.join(' 또는 ')}`, aria: keys.map(aria).join(' '), cap: again };
}
// A name cut to n characters with an ellipsis (a conversation's long title in a dialog's title).
const clipName = (s, n) => {
  const cs = Array.from(String(s));
  return cs.length > n ? `${cs.slice(0, n - 1).join('')}…` : cs.join('');
};

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
// How the last thing was done: 'pointer' (a finger, a mouse) or 'key'. A menu or sheet opened by
// a tap leaves the focus on itself, so no item looks picked, even on a tablet with a keyboard;
// opened from a key, its first item (or OK) takes the focus for ↑↓ and Enter.
let lastInput = 'pointer';
addEventListener('pointerdown', () => (lastInput = 'pointer'), true);
addEventListener('keydown', (e) => !['Control', 'Alt', 'Shift', 'Meta'].includes(e.key) && (lastInput = 'key'), true);

// The last pointer down: its kind (mouse, pen, touch), where, and on what. A menu asked for just
// after it opens beside that (menu's anchor).
const lastPointer = { type: 'mouse', x: 0, y: 0, el: null, t: 0 };
addEventListener('pointerdown', (e) => Object.assign(lastPointer, { type: e.pointerType || 'mouse', x: e.clientX, y: e.clientY, el: e.target, t: Date.now() }), true);

// items: [key, label, danger, note, action] (action: keymap.js's, whose key shows at the end of
// the row with a keyboard: the key that works here, the shell view's own), or '-' to start a new
// block. The danger items make the last block.
// Two ways to show it. Split and asked for by a mouse or a key: a small popover beside what asked
// (anchor: { el, x, y, mark }: a right-click's point, else under the button, or under the row; mark:
// the row it is about, marked while it is open), no 취소 (Esc, Ctrl+[, a click outside). Asked for by a finger, or on the phone: the sheet, opened from a key with its
// first item focused, by a tap with the sheet itself focused so no item looks picked.
// ↑↓ (Ctrl+J/K, the scroll keys) move through the items, Home/End to the first and last.
function menu(title, items, { sub = '', anchor = null } = {}) {
  return new Promise((resolve) => {
    const kbd = keyboardLikely();
    const ctx = hintCtx();
    const at = menuAnchor(anchor);
    const pop = Boolean(split && at && !(lastInput === 'pointer' && lastPointer.type === 'touch'));
    // off: why the item can't be used now (an offline host's ghost, actions.js ghostOff), said in its place.
    // on: the one chosen now (a picker's current value): checked, and focused first from a key.
    const row = ([key, label, danger, note, action, off, on]) => {
      const k = kbd && action && !off ? Keymap.hint(action, ctx) : '';
      const sub = off || note;
      const check = on ? `<span class="act-check" aria-hidden="true">${ICON.check}</span>` : '';
      return `<button class="action ${danger ? 'danger' : ''}${on ? ' on' : ''}" data-k="${esc(key)}"${off ? ' disabled' : ''}${on ? ' aria-current="true"' : ''}><span class="act-main">${esc(label)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span>${k ? `<kbd class="act-key">${esc(k)}</kbd>` : ''}${check}</button>`;
    };
    const blocks = [[]];
    for (const x of items.filter(Boolean)) {
      if (x === '-') blocks.push([]);
      else if (!x[2]) blocks[blocks.length - 1].push(x);
    }
    const risky = items.filter((x) => Array.isArray(x) && x[2]);
    const el = document.createElement('div');
    el.className = `sheet-back${pop ? ' as-pop' : ''}`;
    el.innerHTML = `<div class="sheet${pop ? ' pop' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
        <h2>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h2>
        ${[...blocks.filter((b) => b.length), ...(risky.length ? [risky] : [])].map((b) => `<div class="actions">${b.map(row).join('')}</div>`).join('')}
        ${pop || lastInput === 'key' ? '' : '<button class="btn secondary wide" data-k="">취소</button>'}
      </div>`;
    let layer = null;
    const mark = at && (at.mark || at.el);
    const done = (v) => closeLayer(layer, v);
    // A block body: an onclick that returns false would cancel the submit button's click.
    el.onclick = (e) => {
      if (e.target === el) done(null);
    };
    el.addEventListener('contextmenu', (e) => {
      if (e.target === el) {
        e.preventDefault();
        done(null);
      }
    });
    el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => done(b.dataset.k)));
    el.addEventListener('keydown', (e) => menuKey(e, el));
    if (mark && mark.classList) mark.classList.add('menu-target');
    layer = openLayer(el, {
      onClose: (v) => {
        if (mark && mark.classList) mark.classList.remove('menu-target');
        resolve(v || null);
      },
      // From a key the first item; from a pointer the menu itself (↓ then goes to the first).
      focus: lastInput === 'key' ? (el.querySelector('.action.on:not(:disabled)') ? '.action.on' : '.action') : '.sheet',
    });
    if (pop) placePop(el.querySelector('.sheet'), at);
  });
}
// What a menu opens beside: the anchor given, else what was just clicked (a button, a link, a row),
// else the focused control a key opened it from. null: nothing to open beside (the middle).
function menuAnchor(a) {
  if (a && (a.el || a.x != null)) return a;
  if (a && a.nodeType === 1) return { el: a };
  const fresh = lastInput === 'pointer' && Date.now() - lastPointer.t < 1500 && lastPointer.el && lastPointer.el.isConnected;
  const from = fresh ? lastPointer.el.closest && lastPointer.el.closest('button, a, [data-kind], [role=button]') : document.activeElement;
  if (!from || from === document.body || !from.getBoundingClientRect) return null;
  return { el: from };
}
// The popover beside its anchor, inside the window: under a button with their right edges lined
// up (the left edges where that would leave the window), under a wide row a little in, at a point
// from there; above when there is no room under it.
function placePop(box, a) {
  const m = 8;
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const r = a.x != null ? { left: a.x, right: a.x, top: a.y, bottom: a.y, width: 0 } : a.el.getBoundingClientRect();
  let left = a.x != null ? r.left : r.width > 160 ? r.left + 16 : r.right - w < m ? r.left : r.right - w;
  left = Math.max(m, Math.min(left, innerWidth - w - m));
  let top = r.bottom + 4;
  if (top + h > innerHeight - m) top = r.top - h - 4 >= m ? r.top - h - 4 : Math.max(m, innerHeight - h - m);
  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
}
// ↑↓ (and the scroll keys, Ctrl+J/K) through a menu's items, round at the ends; Home/End.
function menuKey(e, el) {
  if (e.isComposing || e.altKey || e.metaKey) return;
  const acts = [...el.querySelectorAll('.action:not(:disabled)')];
  if (!acts.length) return;
  const i = acts.indexOf(document.activeElement);
  const has = (action) => Keymap.keysFor(action).some((k) => Keymap.matches(e, k));
  const bare = !e.ctrlKey && !e.shiftKey;
  let to = null;
  if ((bare && e.key === 'ArrowDown') || has('scrollDown')) to = i < 0 ? 0 : (i + 1) % acts.length;
  else if ((bare && e.key === 'ArrowUp') || has('scrollUp')) to = i < 0 ? acts.length - 1 : (i - 1 + acts.length) % acts.length;
  else if (bare && e.key === 'Home') to = 0;
  else if (bare && e.key === 'End') to = acts.length - 1;
  if (to == null) return;
  e.preventDefault();
  e.stopPropagation();
  acts[to].focus();
}

// Toasts stack above the composer (newest at the bottom, three at most); the same text again
// replaces the old one. The box is a polite live region on the page from the start (VoiceOver
// misses a status that arrives together with its region); an error is announced at once (role=alert).
// A tap or a push down puts one away. action: { label, run } adds a button (다시 보내기), and such a
// toast stays until it is used, put away (an × for that) or the page changes (WCAG 2.2.1).
let toastBox = null;
function toastRoot() {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    toastBox.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastBox);
  }
  return toastBox;
}
addEventListener('DOMContentLoaded', toastRoot);
// id: one toast per id (a setting turned on, then off: the second replaces the first).
function toast(text, { error = false, action = null, ms, id = '' } = {}) {
  const box = toastRoot();
  for (const old of box.querySelectorAll('.toast')) if (old.dataset.text === text || (id && old.dataset.id === id)) old.remove();
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`;
  if (error) el.setAttribute('role', 'alert');
  el.dataset.text = text;
  if (id) el.dataset.id = id;
  el.innerHTML = `<span class="t">${esc(text)}</span>${action ? `<button type="button" class="t-act">${esc(action.label)}</button><button type="button" class="t-x" aria-label="알림 닫기">×</button>` : ''}`;
  const remove = () => {
    if (!el.isConnected) return;
    if (reduced()) return el.remove();
    el.classList.add('closing');
    setTimeout(() => el.remove(), 160);
  };
  if (action) {
    el.querySelector('.t-act').onclick = () => {
      remove();
      action.run();
    };
    el.querySelector('.t-x').onclick = remove;
  }
  toastGestures(el, remove);
  box.appendChild(el);
  placeToasts();
  const all = box.querySelectorAll('.toast:not(.closing)');
  for (let i = 0; i < all.length - 3; i++) all[i].remove();
  if (ms || !action) setTimeout(remove, ms || (error ? 4500 : 3200));
  else addEventListener('hashchange', remove, { once: true }); // its button is about the page it came on
}
// A tap on a toast (not on its buttons) puts it away; so does pushing it down past 28px, the
// toast following the finger meanwhile and going back when let go short of that.
function toastGestures(el, remove) {
  let g = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.button > 0) return;
    g = { id: e.pointerId, y: e.clientY, x: e.clientX, dy: 0, moved: 0 };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
  });
  el.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    g.dy = Math.max(0, e.clientY - g.y);
    g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.x, e.clientY - g.y));
    el.classList.remove('settling');
    el.style.transform = g.dy ? `translateY(${g.dy}px)` : '';
    el.style.opacity = g.dy ? String(Math.max(0.3, 1 - g.dy / 120)) : '';
  });
  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const { dy, moved } = g;
    g = null;
    if (e.type === 'pointerup' && (dy > 28 || moved < 8)) return void remove();
    el.classList.add('settling');
    el.style.transform = '';
    el.style.opacity = '';
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
const toastErr = (text, action) => toast(text, { error: true, action });
// Toasts sit just above whatever is at the bottom of the screen now (the workspace page's buttons too): the composer with its photo
// tray or command list (two lines tall, on the keyboard), the shell's key row and line, the tab
// bar, or the 「방금 본 대화」 chip over it (fwdchip.js). Without one, the CSS place (80px up from
// the bottom). Again as the screen or the composer changes size while one shows (viewport.js fit, typing).
const TOAST_ABOVE = '#d-pal:not([hidden]), #d-tray:not([hidden]), #d-form, #t-keys, #t-form, .tabbar, .ws-dock, .fwd-chip:not(.closing)';
function placeToasts() {
  if (!toastBox || !toastBox.isConnected || !toastBox.children.length) return;
  // Two columns, the shell view: under its header (style.css), clear of the screen's pills at its
  // foot (← 처음으로) and of the folded key row.
  if (split && view.name === 'term') {
    const bar = document.querySelector('#detail-pane .bar');
    toastBox.style.top = bar ? `${Math.round(bar.getBoundingClientRect().bottom + 12)}px` : '';
    return;
  }
  let top = Infinity;
  for (const el of document.querySelectorAll(TOAST_ABOVE)) {
    const r = el.getBoundingClientRect();
    if (r.height && r.top > innerHeight / 3) top = Math.min(top, r.top);
  }
  toastBox.style.top = top < Infinity ? `${Math.round(top - 8)}px` : '';
}
document.addEventListener('input', () => toastBox && toastBox.children.length && requestAnimationFrame(placeToasts));
