# Herdr Hub — 작업 규칙

무엇이 어디 있는지는 `README.md` 가 정본이다. 여기에는 이 저장소에서 일할 때 지킬 규칙만 둔다.

## 단축키

- Hub 의 키보드 단축키는 **`public/keymap.js` 한 곳에만** 둔다. 표(`BINDINGS`)에 한 줄을 더하고, 하는 일은 `public/app.js` 의 `KEY_ACTIONS` 에 둔다. 다른 파일에 `keydown` 으로 새 단축키를 만들지 않는다.
- 새 기능에 키보드로 할 만한 조작이 있으면 **그 기능을 넣을 때 단축키도 함께** 표에 넣는다. 그 동작의 버튼이 있으면 버튼 HTML 에 `keyAttrs('<action>', '<이름>')` 를 붙여 툴팁과 Ctrl/Alt 를 누르고 있을 때의 배지에 키가 보이게 한다. 「단축키」 페이지(`#/keys`, Ctrl+?, 설정 → 단축키)는 표에서 그리므로 따로 고칠 것이 없다.
- 그 입력 칸 안에서만 처리하는 키(메시지 칸의 리턴·↑↓, 셸의 키 직접 입력)는 그 칸에서 처리하되, 사람이 알아야 하면 `LOCAL` 에 적어 단축키 페이지에 보이게 한다.
- 사람은 기기마다 키를 바꿀 수 있다(단축키 페이지, `keymap.js` setOverrides). 그래서 키를 코드에 직접 적지 말고 `Keymap.match`·`Keymap.hint`·`Keymap.keysFor(action)` 으로 읽는다. 키 자체가 뜻인 동작(1–9 처럼)은 ACTIONS 에 `fixed: true` 를 둔다.
- 셸 화면에서 Hub 가 어떤 키를 쓰는지는 **표의 `shell` 한 곳**이 정한다. 셸의 키 직접 입력 칸은 키를 먼저 표에 묻고(`Keymap.shellKey`), `shell` 인 바인딩이 맞으면 Hub 가 쓰고, 아니면 `keys.js` 의 `rawKeyName` 이 이름 붙인 대로 셸로 보낸다(뒤로의 키는 셸의 Esc, ACTIONS 의 `shellEsc`). `rawKeyName` 에 「이 키는 Hub 것」 같은 예외를 다시 넣지 않는다: 그것은 셸이 받을 키를 말할 뿐이다. 그래서 사람이 키를 빼면 그 키는 셸로 돌아가고, 단축키 페이지의 키마다 「셸」 스위치(「셸 화면에서도」, `setShell`)로 셸이 쓰는 키도 Hub 에 줄 수 있다. 셸 화면에서 쓸 일이 없는 동작은 ACTIONS 에 `noShell: true` 를 둔다(스위치가 없다).
- `npm test` 의 `test/keymap.test.js` 가 같은 키가 두 번 묶였는지, 기본 표가 셸 화면에서 셸한테서 가져가는 키가 정해 둔 목록(「the shell keys the defaults take」)과 같은지 검사한다. 기본 바인딩에 `shell` 을 켜서 셸이 쓰는 키를 가져가게 하면 그 목록과 README 를 함께 고친다. 새 단축키를 넣으면 그 키가 어디서 되고 어디서 안 되는지 시험도 더한다.
- 키를 고를 때: 입력 칸에서 글자를 치는 키(맨 글자, 기호)는 입력 칸 밖에서만. 셸 화면에서 Ctrl+글자·Alt+글자·Alt+←/→ 는 셸 몫이다. Galaxy Tab 키보드 덮개의 Esc 는 웹에 오지 않으므로 Esc 만 되는 동작은 Ctrl+[ 도 된다(이미 `back`).

## 설정

- 설정 화면의 설정값은 **`public/prefs.js` 의 표(`PREFS`) 한 곳에만** 둔다. 새 설정은 표에 한 줄(저장 키·묶음·이름·종류·기본값·안내)을 더하면 설정 화면에 그려진다. `settings.js` 에 손으로 컨트롤을 만들거나 다른 파일에 localStorage 읽기·쓰기를 새로 만들지 않는다. 쓰는 쪽은 `Prefs.get(key)`, 바뀌는 순간 할 일이 있으면 `core.js` 의 `PREF_EFFECTS` 에 둔다.
- 저장 키와 값은 바꾸지 않는다: 모든 기기가 그 키로 설정을 갖고 있다(`herdr-hub.theme` 은 `index.html` 이 스크립트보다 먼저 읽는다). `test/prefs.test.js` 가 예전 코드가 쓴 값을 그대로 읽는지 검사하니, 새 줄을 넣으면 그 시험의 키 목록에도 더한다.
- 설정 화면에 그 설정의 단축키가 있으면 단축키 규칙(위)을 따른다.
