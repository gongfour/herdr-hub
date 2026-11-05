# Herdr Hub — 작업 규칙

무엇이 어디 있는지는 `README.md` 가 정본이다. 여기에는 이 저장소에서 일할 때 지킬 규칙만 둔다.

## 단축키

- Hub 의 키보드 단축키는 **`public/keymap.js` 한 곳에만** 둔다. 표(`BINDINGS`)에 한 줄을 더하고, 하는 일은 `public/app.js` 의 `KEY_ACTIONS` 에 둔다. 다른 파일에 `keydown` 으로 새 단축키를 만들지 않는다.
- 새 동작(ACTIONS)에는 짧은 `name`(단축키 페이지의 한 줄, 12자 안, 「:」·「(」 없이)과 긴 `label`(자세한 설명, 바꾸기에서 보인다)을 함께 둔다. LOCAL 줄도 `name` 을 둔다. 단축키 페이지의 탭(어디서나·대화·셸·목록)은 묶음(`group`)과 셸 화면의 키에서 저절로 정해지니, 다른 화면에서도 되는 동작이면 `also: ['list']` 처럼 더한다(`keymap.js` tabsOf; 시험이 이름과 탭을 검사한다).
- 단축키 표의 동작은 모두 명령(빠른 이동의 `>`, Ctrl+Shift+P·F1, `palette.js`)에도 저절로 나온다: 이름은 label 의 「:」·「 (」 앞까지, 짧게 하려면 `cmd`. 키로만 뜻이 있는 동작(스크롤, 포커스 옮기기)은 ACTIONS 에 `noCommand: true` 를 둔다. 할 수 없는 곳에서 숨기려면 `switcher.js` 의 `COMMAND_CAN` 에 한 줄, 키와 다르게 돌려야 하면 `COMMAND_RUN` 에 둔다. ⋯ 메뉴 항목은 `actions.js` 의 `paneMenuItems`·`wsMenuItems` 한 곳에 두면 메뉴와 명령에 함께 나온다(항목의 다섯째 칸에 단축키 동작을 적으면 명령에는 그 동작 쪽으로 한 번만 나온다).
- 에이전트·셸은 「끝내기」, 워크스페이스는 「워크스페이스 닫기」, 그냥 「닫기」는 대화창 닫기(화면에서 나오기)다. 확인 창·메뉴·단축키 페이지·알림에서 이 말을 섞지 않는다. 되돌릴 수 없는 확인 창은 `sheet({ danger, key })` 로만 만들고 키를 본문에 따로 적지 않는다(확인 단추의 툴팁이 말한다).
- 새 기능에 키보드로 할 만한 조작이 있으면 **그 기능을 넣을 때 단축키도 함께** 표에 넣는다. 그 동작의 버튼이 있으면 버튼 HTML 에 `keyAttrs('<action>', '<이름>')` 를 붙여 툴팁에 키가 보이게 한다. 「단축키」 페이지(`#/keys`, Ctrl+?, 설정 → 단축키)는 표에서 그리므로 따로 고칠 것이 없다.
- 그 입력 칸 안에서만 처리하는 키(메시지 칸의 리턴·↑↓, 셸의 키 직접 입력)는 그 칸에서 처리하되, 사람이 알아야 하면 `LOCAL` 에 적어 단축키 페이지에 보이게 한다.
- 사람은 기기마다 키를 바꿀 수 있다(단축키 페이지, `keymap.js` setOverrides). 그래서 키를 코드에 직접 적지 말고 `Keymap.match`·`Keymap.hint`·`Keymap.keysFor(action)` 으로 읽는다. 키 자체가 뜻인 동작(1–9 처럼)은 ACTIONS 에 `fixed: true` 를 둔다.
- 셸 화면에서 Hub 가 어떤 키를 쓰는지는 **표의 `shell` 한 곳**이 정한다. 셸의 키 직접 입력 칸은 키를 먼저 표에 묻고(`Keymap.shellKey`), `shell` 인 바인딩이 맞으면 Hub 가 쓰고, 아니면 `keys.js` 의 `rawKeyName` 이 이름 붙인 대로 셸로 보낸다(뒤로의 키는 셸의 Esc, ACTIONS 의 `shellEsc`). `rawKeyName` 에 「이 키는 Hub 것」 같은 예외를 다시 넣지 않는다: 그것은 셸이 받을 키를 말할 뿐이다. 그래서 사람이 키를 빼면 그 키는 셸로 돌아가고, 단축키 페이지의 키마다 「셸」 스위치(「셸 화면에서도」, `setShell`)로 셸이 쓰는 키도 Hub 에 줄 수 있다. 셸 화면에서 쓸 일이 없는 동작은 ACTIONS 에 `noShell: true` 를 둔다(스위치가 없다).
- `npm test` 의 `test/keymap.test.js` 가 같은 키가 두 번 묶였는지, 기본 표가 셸 화면에서 셸한테서 가져가는 키가 정해 둔 목록(「the shell keys the defaults take」)과 같은지 검사한다. 기본 바인딩에 `shell` 을 켜서 셸이 쓰는 키를 가져가게 하면 그 목록과 README 를 함께 고친다. 새 단축키를 넣으면 그 키가 어디서 되고 어디서 안 되는지 시험도 더한다.
- 키를 고를 때: 입력 칸에서 글자를 치는 키(맨 글자, 기호)는 입력 칸 밖에서만. 셸 화면에서 Ctrl+글자·Alt+글자·Alt+←/→ 는 셸 몫이다. Galaxy Tab 키보드 덮개의 Esc 는 웹에 오지 않으므로 Esc 만 되는 동작은 Ctrl+[ 도 된다(이미 `back`).
- 기기마다 표가 다르다: `keymap.js` 의 `table({ mac, app })` 이 표를 만들고, 페이지는 `Keymap.setEnv` 로 그 기기를 넘긴다(`core.js`; 표 안에서 `navigator`·`matchMedia` 를 읽지 않는다). **설치한 앱**에서는 브라우저의 탭·창 키(Ctrl+W·Ctrl+N·Ctrl+T·⌘W·⌘N …)가 Hub 의 것이니 써도 된다. 브라우저 탭에서는 브라우저 것이라 묶지 않는다(`BROWSER`). 앱을 끝내거나 시스템이 쓰는 키(⌘Q·⌘H·⌘M·⌘Tab·⌘Space·⌘`·Alt+F4·Ctrl+Shift+Q, `SYSTEM`)는 어디서도 쓰지 않는다. **Mac** 에서는 Hub 의 Ctrl+글자·기호 키에 ⌘ 짝을 먼저 두고(`when(mac, …)` 을 Ctrl 줄 앞에) Ctrl 짝도 남긴다. ⌘ 조합은 셸로 가지 않으니 ⌘ 키는 `shell: true` 여도 셸 키를 뺏지 않는다. 기기에 따라 키를 더하거나 빼면 `test/keymap.test.js` 의 기기별 시험(네 기기 모두 같은 키 두 번 없음, 셸에서 가져가는 키 목록이 같음)을 함께 고친다.

## 설정

- 설정 화면의 설정값은 **`public/prefs.js` 의 표(`PREFS`) 한 곳에만** 둔다. 새 설정은 표에 한 줄(저장 키·묶음·이름·종류·기본값·안내)을 더하면 설정 화면에 그려진다. `settings.js` 에 손으로 컨트롤을 만들거나 다른 파일에 localStorage 읽기·쓰기를 새로 만들지 않는다. 쓰는 쪽은 `Prefs.get(key)`, 바뀌는 순간 할 일이 있으면 `core.js` 의 `PREF_EFFECTS` 에 둔다.
- 저장 키와 값은 바꾸지 않는다: 모든 기기가 그 키로 설정을 갖고 있다(`herdr-hub.theme` 은 `index.html` 이 스크립트보다 먼저 읽는다). `test/prefs.test.js` 가 예전 코드가 쓴 값을 그대로 읽는지 검사하니, 새 줄을 넣으면 그 시험의 키 목록에도 더한다.
- 설정 화면에 그 설정의 단축키가 있으면 단축키 규칙(위)을 따른다.

## 여백

- `style.css` 의 padding·margin·gap 은 **`--sp-*` 토큰으로만** 쓴다(`:root` 맨 위: 2·4·8·12·16·24·32·48px). 그 사이 값(6·10·14px …)을 새로 적지 않는다. 숫자로 남기는 것은 그 파일 맨 위 주석에 적은 경우뿐이다: 패딩을 되돌리거나 누를 자리를 넓히는 음수 margin, 1px 보정, safe-area, 정해진 높이에 한 줄을 가운데 두는 calc.
- 이미 정한 크기는 그대로 둔다: 가장자리(휴대폰 16px, 넓은 화면 `--gut`), `--bar-h`, 손가락 44px·마우스 32px 목표 크기.

## 호스트(피어) 목록

- 허브의 피어 목록은 허브의 데이터(`data/peers.json`, `lib/hoststore.js`)이고 설정 → 연결에서 고친다. 기기마다의 설정이 아니므로 `prefs.js` 표에 넣지 않는다. `HERDR_HUB_PEERS` 는 파일이 없을 때만 쓰는 씨앗이다 — `run.cmd` 를 고쳐도 이미 있는 목록은 바뀌지 않는다.
- 피어를 더하면 허브가 사람이 적은 주소로 요청을 보낸다. 그 요청은 `hoststore` 의 규칙(http(s) 출처만, 리다이렉트 안 따름, 짧은 제한)을 지키고, 피어 프록시(`PROXIED`) 밖으로 넘기는 경로를 새로 만들지 않는다. CORS 는 `/api/version` 한 곳뿐이다.
- 시험할 때 실제 허브(desktop)의 피어를 더하거나 빼지 않는다. 로컬 한 쌍(허브 8797, 피어 8798, 각자 `HERDR_HUB_DATA`)에서 한다.

## 파일 시스템 (멈추지 않기)

- 요청을 받는 길(요청 처리, `refresh`)에서 `fs.*Sync` 를 쓰지 않는다. 남의 폴더(에이전트 cwd, `~/.claude`, 대화 기록, 사람이 고른 경로)는 `lib/fsq.js`(`fsq.budget(ms)` 를 만들어 `readdir`·`stat`·`readPart` …에 넘긴다)로만 읽고, 예산이 다하면 찾은 것까지 `partial` 로 돌려준다. 걷기는 cwd 하나에 하나만 돈다. Hub 자기 파일(`data/`, `public/`, 사진 폴더)은 그대로 둬도 되지만 요청 길이면 비동기로 한다. 시작 때 읽는 설정·`build.json` 은 동기여도 된다.
- 감시 스레드(`lib/watchdog.js`, `HERDR_HUB_WATCHDOG_MS`, 0 = 끔)가 30 초 멈춘 프로세스를 죽이고 launchd·`run.cmd` 의 반복이 다시 띄운다. 그 반복이나 KeepAlive 를 없애지 않는다. 시험: `test/nohang.test.js`(서버를 띄워 메인 스레드를 막고, `readdir` 을 막는다 — `test/fixtures/stall.js`).

## 버전

- 파일 주소의 `?v=` 는 서버가 내용 해시로 붙인다(`lib/http.js` `indexPage`). `index.html` 에 `?v=` 를 적거나 올리지 않는다 — 새 파일도 `<script src="/x.js" defer>` 그대로 넣는다. 배포만 하면 바뀐 파일만 새로 받고, 설치된 앱은 빌드가 달라진 것을 알아본다.
- 빌드 이름은 `package.json` 의 major.minor + 커밋 수다. major.minor 는 큰 개편 때만 손으로 올린다(그 밖에는 건드리지 않는다).
- `server.js` 의 `API_VERSION` 은 허브↔피어 또는 앱↔서버 약속(API 경로·모양, 실시간 연결의 메시지, 피어에게 넘기는 요청)이 예전 쪽과 맞지 않게 바뀔 때 1 올린다. 그러면 한쪽만 배포된 동안 설정 → 연결에 「배포가 필요합니다」가 뜬다. 예전 쪽과 함께 도는 변경(필드를 더하기만 하는 것)은 올리지 않는다.
