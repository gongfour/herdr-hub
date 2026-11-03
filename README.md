# Herdr Hub

예전 이름은 Paddock 이었다. 저장소·폴더(`herdr-hub`)·예약 작업(`HerdrHub`)·LaunchAgent(`local.herdr-hub`)·헤더(`X-Herdr-Hub`)·환경 변수(`HERDR_HUB_*`)까지 모두 바꿨다. 예전 `paddock-uploads` 사진과 브라우저 설정(`paddock.*`)은 처음 실행할 때 새 이름으로 옮긴다.

herdr 에이전트를 휴대폰에서 보고 답하는 웹앱(PWA). herdr가 도는 호스트에서 돌고, Tailscale 로만 접속한다.

- 서버: `server.js` — herdr API 소켓(Windows 는 named pipe)에 직접 붙는다. SSH·셸을 거치지 않는다.
- 화면: `public/` — 빌드 없는 바닐라 JS. 목록(응답 필요 → 완료 → 작업 중 → 대기), 에이전트 보기(대화 + 작업 줄 + 터미널 화면 시트), 응답 키, 보내기, 중단(Esc), 웹 푸시 알림.
- 관리: 새 워크스페이스(호스트·폴더·이름, 바로 에이전트 시작), 에이전트 시작(기존 셸 패널 또는 새 탭; 종류·인자·이름), 일반 터미널 패널(화면 보기, 명령 한 줄, Ctrl+C·Enter·↑↓·Tab·Esc), 새 탭·패널 나누기, 이름 바꾸기·닫기. 닫기는 늘 페이지 안에서 한 번 더 묻는다.
  - 폴더 고르기: 최근 폴더를 큰 줄로 보여 주고 한 번 누르면 고른다. 「폴더 찾아보기」는 아래에서 올라오는 시트로, 경로 조각(누르면 그 폴더로), 바로 가기(홈·`~/Project`·`~/src`·Desktop·Documents, Windows 는 `C:`·`D:` 중 있는 것), 하위 폴더 목록, 「↑ 상위」, 늘 보이는 「이 폴더 선택」, 「새 폴더」(이름을 받아 만들고 바로 고름)가 있다. Windows 는 드라이브 루트의 상위가 드라이브 목록이다. 경로를 직접 적는 칸은 「경로 직접 입력」 뒤에 있다. 호스트를 바꾸면 고른 폴더와 찾아보기 위치가 처음으로 돌아간다. 이름을 비우면 폴더 이름이 된다.
  - API: `GET /api/dirs?path=<절대 경로>` → `{path, parent, sep, crumbs, dirs}`(하위 폴더 이름만, 대소문자 무시 정렬, 500개까지; 비우면 홈; 읽을 수 없으면 `denied: true`). `?drives=1` 또는 `path=::drives` 는 드라이브 목록. 점·`$` 로 시작하는 것, `node_modules`·`AppData`·`System Volume Information` 같은 것, 열 수 없는 링크(Windows 옛 프로필 정션)는 숨긴다. 링크 확인은 1초 안에 끝나지 않으면 건너뛰고 다시 보지 않는다(macOS `/home` 자동 마운트가 멈춤). `POST /api/dirs {parent, name}` 은 새 폴더를 만들고 `{path}` 를 돌려준다 — 이름은 100자까지, `/ \ : * ? " < > |`·제어 문자·`.`·`..`·끝의 점/공백·`CON` 같은 예약 이름은 `400 bad_dir_name`, 이미 있으면 `409 dir_exists`. `/api/host` 는 `places`(있는 바로 가기 폴더)도 준다.
  - 폴더는 그 호스트에 있는 절대 경로만, 에이전트 종류는 `server.js` 의 `KINDS` 목록만, 인자는 영숫자와 `-_=.:/,@+%\` 만 받는다.
  - 새 폴더에서 Claude 를 처음 띄우면 폴더 신뢰 질문이 나온다. 아래 선택 버튼으로 답한다.
- 에이전트 보기: 패널 종류마다 보기가 하나다. Claude 에이전트는 늘 대화(기록)를 보여 준다(대화/화면 탭은 없앴다). 기록이 없는 다른 에이전트(codex 등)는 그 자리에 터미널 화면을 보여 준다(`agent !== 'claude'`, 서버의 `supported: false` 와 같은 기준). 막 시작해 기록이 아직 없는 Claude 는 「아직 대화 기록이 없습니다」. 일반 셸 패널은 전처럼 `#/term/<pane>` 터미널 보기다.
  - 작업 줄: 작업 중일 때만 머리글 아래에 한 줄. 3초마다 `screen?source=visible`(맨 글)을 읽어 `public/activity.js` 가 Claude 의 스피너 줄(`✻ Flowing… (1m 17s · ↓ 5.1k tokens)`)에서 활동 낱말·경과 시간·토큰을, 그 위 도구 줄(`⏺`/Windows `●`)에서 마지막 도구를 읽는다(시험은 `npm test`). 화면에 도구가 없으면 이번 차례 기록의 마지막 도구를 쓴다. 못 읽으면 「작업 중…」과 작업 중이 된 뒤(이 화면에서 본 때부터) 지난 시간. 시간은 읽는 사이에도 1초마다 간다.
  - 터미널 화면 시트: 작업 줄을 누르거나 ⋯ → 「터미널 화면 보기」. 아래에서 올라오는 높은 시트에 아래의 화면 상자(색상·줄바꿈, 따라가기·멈춤, 「↓ 새 출력」, 고르는 동안 멈춤)를 그대로 쓴다. ✕·바깥·Esc·맨 위 안내의 「대화」로 닫고, 닫으면 읽기를 멈춘다. 예전 화면 탭 주소 `#/h/<host>/agent/<pane>/screen` 은 대화를 열고 그 위에 시트를 띄운다.
- 응답 필요: 화면 맨 아래의 선택지(`❯ 1. Yes` 같은 번호 목록, 또는 신뢰 질문처럼 번호 없이 커서만 있는 목록)를 읽어 질문과 선택지마다 큰 버튼을 보여 준다(`public/choices.js`, 시험은 `npm test`).
  - 번호 목록은 그 숫자 키 하나만 보낸다. Claude Code 2.1.316 에서 숫자 하나로 바로 선택·확정되는 것을 확인했다. 번호 없는 목록은 커서에서 ↑/↓ 로 옮긴 뒤 Enter.
  - 누른 뒤 4초 동안(또는 상태가 바뀔 때까지) 버튼을 잠가, 두 번 누름이 다음 질문에 답하지 않게 한다. 거절(No·취소 등)은 경고색.
  - 전체 화면은 「화면 보기」, 1·2·3·Enter·Esc·↑·↓ 키는 「직접 입력」 뒤에 있다. 목록을 못 읽으면 예전처럼 화면과 키를 바로 보여 준다.

- 화면 상자(에이전트 터미널 화면 시트, 기록 없는 에이전트의 본문, 터미널 보기): 2.5–3초마다 다시 읽지만 글이 바뀔 때만 다시 그린다.
  - 맨 아래(40px 안)에 있으면 새 출력을 따라가고, 위로 올려 읽는 동안은 멈추고 「↓ 새 출력」 단추를 띄운다. 글을 고르는 중이거나 손가락을 대고 있는 동안에도 멈춘다(복사할 수 있게).
  - 「줄바꿈」: 에이전트는 기본 끔(줄을 그대로 두고 상자 안에서 옆으로 넘김 — Claude 의 가로줄·상태 줄이 깨지지 않는다), 터미널은 기본 켬. 보기마다 이 기기에 기억한다.
  - 「색상」: 기본 켬. 화면을 `format=ansi` 로 읽어(herdr 0.9.3 부터, 색 코드 SGR 만 온다) `public/ansi.js` 가 색을 입힌 HTML 로 바꾼다. 글은 모두 이스케이프하고 SGR 이 아닌 코드(OSC·커서 이동·잘린 코드)는 버린다. 기본 16색은 테마마다 맞춘 `--ansi-0..15`, 256색·트루컬러는 글자가 바탕과 4.5:1 이상 대비가 나도록 같은 색조로 진하게(밝은 테마)·밝게(어두운 테마) 고친다. 어두운 터미널용 배경(Claude 의 diff 줄)은 밝은 테마에서 같은 색조의 옅은 바탕이 된다. 끄면 예전처럼 맨 글. 선택·복사는 맨 글이다. 이 기기에 기억한다. 이 형식을 모르는 herdr 면 서버가 맨 글로 읽는다(응답의 `format`). 선택지 읽기·대화 기록은 늘 맨 글.
  - 읽는 범위: 터미널은 `recent_unwrapped`(herdr 가 이미 패널 폭에서 자른 줄이 아니라 원래 줄; 지원하지 않는 herdr 면 `recent`). 에이전트는 작업 중·응답 필요일 때 `visible`, 그 밖에는 `recent`. 작업 중이라 `recent` 를 못 읽으면(`agent_not_idle`) 서버가 `visible` 로 다시 읽는다. 응답의 `source` 가 실제로 읽은 범위다.
  - 읽기 실패는 알림을 띄우지 않고 화면 위 한 줄에 한 번만 보여 준다.
- 화면 틀(iPhone 키보드·밀기): 문서 자체는 스크롤하지 않는다(`html`·`body` 는 `overflow: hidden`, `overscroll-behavior: none`). 앱은 고정된 틀(`#app`) 안에 있고 목록·대화·화면·시트만 안에서 스크롤한다(`overscroll-behavior: contain`).
  - iOS 는 키보드가 열려도 레이아웃 뷰포트를 그대로 두고 보이는 영역(visual viewport)만 줄이며 문서를 위로 밀어 올린다. 그래서 틀의 높이와 위치를 `visualViewport.height`·`offsetTop` 에 맞추고(`--app-h`·`--app-top`), 문서가 밀리면 `scrollTo(0,0)` 으로 되돌린다. 머리글은 늘 맨 위, 입력 칸은 키보드 바로 위에 있다. 맨 아래를 따라가던 대화·화면은 그대로 맨 아래에 붙는다. 확대(핀치)한 동안은 건드리지 않는다. 키보드가 열리면 아래 안전 영역 여백을 없앤다.
  - iOS 에서는 손가락 아래에 그 방향으로 스크롤할 것이 없으면 `touchmove` 를 막는다(첫 움직임으로 가로·세로를 정한다). 그래서 머리글을 끌어도, 대화에서 옆으로 밀어도 페이지가 움직이지 않는다. 화면 상자는 `touch-action: pan-x pan-y` 로 옆으로 밀면 상자 안에서만 넘어가고, 글 위에서 위아래로 밀면 상자가 스크롤한다.
- 사진 첨부(에이전트 입력 칸만): 📎 → 사진 보관함·카메라(`accept="image/*" multiple`, 한 번에 6장까지). 입력 칸 위에 미리보기가 뜨고 ✕ 로 뺀다. 글이나 사진 중 하나만 있어도 보낼 수 있다.
  - 📷 는 바로 카메라를 연다(`capture="environment"`).
  - 붙여넣기: 입력 칸에 이미지를 붙여 넣으면(iOS: 스크린숏 → 미리보기 누르기 → 복사(또는 복사 후 삭제) → 입력 칸 길게 눌러 붙여넣기) 같은 첨부로 들어간다(`paste` 의 `clipboardData.files`, 없으면 `items` 의 file 항목). 글은 그대로 붙는다. 이미지만 있을 때는 글자를 넣지 않는다.
  - 휴대폰에서 긴 변 2000px 까지 줄이고 JPEG 0.85 로 다시 만든다(EXIF 회전 반영, `createImageBitmap(…, {imageOrientation: 'from-image'})`, 안 되면 `<img>` 로). 2000px 안의 PNG·WebP(8MB 이하)는 그대로 보낸다. 읽을 수 없는 파일은 알림 한 줄로 거절한다.
  - 보낼 때 사진마다 에이전트가 있는 호스트에 먼저 올리고(`POST /api/uploads`, 본문은 사진 그대로 `image/jpeg|png|webp`, `X-Herdr-Hub`, 10MB 까지, 피어는 허브가 이진 그대로 넘긴다), 프롬프트는 「글 + 줄마다 절대 경로 하나」로 보낸다. 서버는 `<임시 폴더>/herdr-hub-uploads/<yyyymmdd-hhmmss>-<임의>.<확장자>` 에 저장하고 `{path, name}` 을 돌려준다(내용이 형식과 맞아야 한다). 시작할 때와 하루에 한 번 7일 지난 파일을 지운다. `GET /api/uploads/<name>` 은 그 폴더의 그 이름 꼴 파일만 준다.
  - Claude Code 2.1.317 은 프롬프트 안의 이미지 경로를 스스로 첨부한다(경로 자리에 `[Image #N]`, 기록에는 이미지 블록과 `[Image: source: <경로>]` 메타 항목). 그래서 「읽어 달라」는 안내 줄은 붙이지 않는다(desktop·server 의 haiku 로 확인: 그림 속 글자를 읽었다).
  - 대화: 보낸 말풍선에 첨부 사진을 작은 그림으로 보여 주고, 누르면 전체 화면으로 연다. 기록의 메타 항목(또는 글에 남은 경로)에서 업로드 이름을 찾아 `/api/uploads/<name>` 으로 받는다. base64 는 휴대폰으로 보내지 않는다. 업로드가 아닌 이미지(호스트에서 붙여 넣은 것)는 「이미지」 칩으로만 보인다.
- 화면 진단(임시): 설정 → 「화면 진단 보내기」(기본 켬, 이 기기에 기억). 켜 두면 `visualViewport` 크기·스크롤, 포커스 들어옴·나감, 방향 바뀜 때(1초에 두 번까지, 값이 바뀔 때만) 상태를 허브의 `POST /api/debug/viewport` 로 보낸다. 피어로는 넘기지 않는다. 허브가 `data/viewport.log` 에 한 줄에 JSON 하나로 쌓는다. 512KB 를 넘으면 `viewport.log.1` 로 돌리므로 둘 합쳐 1MB 쯤이다. 다른 것은 기록하지 않는다.
  - 붙여넣기마다 `reason: "paste"` 줄도 하나 남긴다: `types`, `items`(kind·type), `fileCount`, `files`(type·size). 내용은 남기지 않는다.
  - 항목: `reason`(이벤트), `route`, `innerHeight`, `clientHeight`, `vvHeight`, `offsetTop`, `pageTop`, `scale`, `scrollY`, `scrollingTop`, 틀에 준 `appH`·`appTop`, `kb`(키보드로 본 상태), `header`·`composer`·`scroller` 의 `{top,bottom,height}`, `focused`, `standalone`, `userAgent`, `ts`(휴대폰 시각), `at`(서버 시각).
  - 읽기(맥에서): `ssh kangw@desktop 'Get-Content C:\Users\kangw\src\herdr-hub\data\viewport.log -Tail 20'`. 키보드를 연 줄에서 `header.top` 이 `offsetTop` 과 같고 `composer.bottom` 이 `offsetTop + vvHeight` 와 같으면 맞다.
  - 끄기: 휴대폰에서 설정 → 「화면 진단 보내기」를 끈다. 기본값을 끄려면 `public/app.js` 의 `diagOn()` 을 바꾼다.

## 여러 호스트 (허브)

desktop 의 Herdr Hub 이 **허브**다. 허브는 다른 Herdr Hub(**피어**)을 자기 화면에 합쳐 보여 주고, 피어 쪽 요청을 대신 전달한다. 휴대폰은 허브 하나(`https://desktop.uaru-monster.ts.net`)만 연다.

| 호스트 | 역할 | 주소 | herdr |
| --- | --- | --- | --- |
| desktop (Windows) | 허브, 알림 | `https://desktop.uaru-monster.ts.net` | 0.9.5 |
| server (이 맥북) | 피어 | `https://server.uaru-monster.ts.net:8443` | 0.9.3 |

- 허브는 피어마다 `/api/stream`(SSE)을 구독한다. 끊기면 다시 붙고(1초부터 최대 30초 간격), 6초 안에 돌아오지 않으면 그 피어를 **오프라인**으로 표시하고 그 항목을 목록에서 뺀다. 연결은 됐는데 50초 동안 아무것도 안 오면(노트북이 잠든 경우) 끊은 것으로 본다.
- 허브의 `/api/state`·`/api/stream` 은 모든 호스트를 합친 것이다. 에이전트·터미널·워크스페이스마다 `host`(id)·`hostLabel` 이 붙고, `hosts` 에 호스트별 `online`·`herdr`·`since` 가 들어 있다.
- 호스트별 요청은 `/api/peers/<id>/<나머지>` 로 보내면 허브가 피어의 `/api/<나머지>` 로 넘긴다(`host`, `dirs`, `agents`, `panes`, `workspaces`, `uploads` 만). 본문은 이진 그대로 오간다(사진 업로드는 10MB, 나머지는 256KB 까지). `X-Herdr-Hub` 검사는 허브에서 먼저 하고 피어로도 넘긴다. 피어가 오프라인이면 `503 peer_offline`, 시간 초과는 `504`(조회 15초, 변경 60초).
- 알림은 허브만 보낸다. 피어의 상태 변화(응답 필요, 완료)도 허브가 보고 보낸다. 피어는 `HERDR_HUB_PUSH=0` 이라 알림을 아예 보내지 않으므로 같은 알림이 두 번 오지 않는다. 피어가 잠든 사이에 생긴 변화도 다시 연결되면 알린다.
  - herdr 0.9.3 은 `completion_seq` 가 없어서, 그 호스트에서는 작업 중 → 완료 로 바뀔 때를 완료로 본다.
- 인증: 피어도 `tailscale serve` 뒤에 있고 `Tailscale-User-Login` 을 `HERDR_HUB_ALLOWED_LOGINS` 와 맞춘다. desktop 노드는 사용자 소유(태그 없음)라 허브 → 피어 요청에도 `tailscale serve` 가 `kangwonjin.dev@gmail.com` 을 붙인다(직접 확인함; 요청에 위조한 값은 serve 가 덮어쓴다). 그래서 따로 비밀값을 두지 않았다. 피어를 태그 노드로 바꾸면 이 머리글이 사라지므로 그때는 공유 비밀을 넣어야 한다.
- 화면: 목록 위의 호스트 선택(전체 / desktop / server, 이 기기에 기억), 호스트가 둘 이상이면 항목마다 호스트 표시, 오프라인 호스트 알림 줄. 주소는 `#/h/server/agent/w3:p1` 처럼 호스트를 포함한다. 예전 주소(`#/agent/…`)는 허브 자신의 호스트로 연다.

### 환경 변수

| 이름 | 뜻 |
| --- | --- |
| `HERDR_HUB_ALLOWED_LOGINS` | 허용할 Tailscale 로그인(쉼표). 또는 `HERDR_HUB_ALLOW_LOCAL=1`(머리글 없는 로컬 접속 허용, 시험용) |
| `HERDR_HUB_HOST_ID` | 짧은 호스트 id(`desktop`, `server`). 영문 소문자로 시작, `all` 은 못 쓴다 |
| `HERDR_HUB_HOST_LABEL` | 화면에 보일 이름 |
| `HERDR_HUB_PEERS` | 허브로 만든다: `id=url` 을 쉼표로. 예 `server=https://server.uaru-monster.ts.net:8443` |
| `HERDR_HUB_PUSH` | `0` 이면 알림을 보내지 않는다(피어용) |
| `HERDR_HUB_VAPID_SUBJECT`, `HERDR_HUB_DATA`, `PORT`, `HOST` | 전과 같음 |

## 운영 — desktop (허브)

- 위치: `C:\Users\kangw\src\herdr-hub`, 로그는 `data\herdr-hub.log`, VAPID 키·구독은 `data\`.
- 시작: 로그온 때 예약 작업 `HerdrHub` 가 `conhost.exe --headless run.cmd` 로 창 없이 띄운다(127.0.0.1:8787). 콘솔 창으로 띄우면 그 창을 닫거나 Ctrl+C 가 눌리는 순간 서버가 꺼진다(종료 코드 0xC000013A). 호스트 id·피어 목록도 `run.cmd` 에 있다. `run.cmd` 는 CRLF 로 둔다(LF 면 cmd 가 `set` 줄을 빠뜨린다).
- 공개: `tailscale serve --bg 8787` → `https://desktop.uaru-monster.ts.net` (tailnet 전용).
- 배포: 맥에서 `./deploy.sh` (또는 `./deploy.sh desktop`).

## 운영 — server (이 맥북, 피어)

- 위치: `~/.local/share/herdr-hub` (저장소 밖 배포본), 로그는 `~/.local/share/herdr-hub/data/herdr-hub.log`.
- 시작: LaunchAgent `local.herdr-hub` (`~/Library/LaunchAgents/local.herdr-hub.plist`) 가 `mac/run.sh` 를 띄운다(127.0.0.1:8787, 로그인 때 시작, 죽으면 다시 띄움). 원본은 저장소의 `mac/`.
- 공개: `tailscale serve --bg --https=8443 http://127.0.0.1:8787` → `https://server.uaru-monster.ts.net:8443`. 443 은 이미 다른 것(`/` → 127.0.0.1:18789)이 쓰고 있어서 건드리지 않았다.
- 배포: `./deploy.sh server` (둘 다는 `./deploy.sh all`). 배포본을 rsync 하고 `npm ci` 후 LaunchAgent 를 다시 올리며, 8443 serve 가 없으면 만든다.
- 노트북이 잠들면 허브에 server 가 오프라인으로 보이고, 깨면 저절로 돌아온다.

## 끄기

desktop:

```powershell
tailscale serve --https=443 off
Unregister-ScheduledTask HerdrHub -Confirm:$false
```

맥(server) — 잠깐 멈추기 / 다시 켜기:

```sh
launchctl bootout gui/$(id -u)/local.herdr-hub
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.herdr-hub.plist
```

맥에서 아주 없애기(다른 serve 설정은 그대로 둔다):

```sh
launchctl bootout gui/$(id -u)/local.herdr-hub
rm ~/Library/LaunchAgents/local.herdr-hub.plist
tailscale serve --https=8443 off
rm -rf ~/.local/share/herdr-hub
```

그다음 desktop `run.cmd` 의 `HERDR_HUB_PEERS` 줄을 지우고 `./deploy.sh` 하면 허브가 혼자 도는 Herdr Hub 으로 돌아간다(지우지 않아도 server 가 계속 오프라인으로 보일 뿐 동작에는 문제없다).
