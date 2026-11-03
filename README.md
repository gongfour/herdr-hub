# Paddock

herdr 에이전트를 휴대폰에서 보고 답하는 웹앱(PWA). herdr가 도는 호스트에서 돌고, Tailscale 로만 접속한다.

- 서버: `server.js` — herdr API 소켓(Windows 는 named pipe)에 직접 붙는다. SSH·셸을 거치지 않는다.
- 화면: `public/` — 빌드 없는 바닐라 JS. 목록(응답 필요 → 완료 → 작업 중 → 대기), 대화(Claude 기록), 화면(터미널), 응답 키, 보내기, 중단(Esc), 웹 푸시 알림.
- 관리: 새 워크스페이스(호스트·폴더·이름, 바로 에이전트 시작), 에이전트 시작(기존 셸 패널 또는 새 탭; 종류·인자·이름), 일반 터미널 패널(화면 보기, 명령 한 줄, Ctrl+C·Enter·↑↓·Tab·Esc), 새 탭·패널 나누기, 이름 바꾸기·닫기. 닫기는 늘 페이지 안에서 한 번 더 묻는다.
  - 폴더는 그 호스트에 있는 절대 경로만, 에이전트 종류는 `server.js` 의 `KINDS` 목록만, 인자는 영숫자와 `-_=.:/,@+%\` 만 받는다.
  - 새 폴더에서 Claude 를 처음 띄우면 폴더 신뢰 질문이 나온다. 아래 선택 버튼으로 답한다.
- 응답 필요: 화면 맨 아래의 선택지(`❯ 1. Yes` 같은 번호 목록, 또는 신뢰 질문처럼 번호 없이 커서만 있는 목록)를 읽어 질문과 선택지마다 큰 버튼을 보여 준다(`public/choices.js`, 시험은 `npm test`).
  - 번호 목록은 그 숫자 키 하나만 보낸다. Claude Code 2.1.316 에서 숫자 하나로 바로 선택·확정되는 것을 확인했다. 번호 없는 목록은 커서에서 ↑/↓ 로 옮긴 뒤 Enter.
  - 누른 뒤 4초 동안(또는 상태가 바뀔 때까지) 버튼을 잠가, 두 번 누름이 다음 질문에 답하지 않게 한다. 거절(No·취소 등)은 경고색.
  - 전체 화면은 「화면 보기」, 1·2·3·Enter·Esc·↑·↓ 키는 「직접 입력」 뒤에 있다. 목록을 못 읽으면 예전처럼 화면과 키를 바로 보여 준다.

## 여러 호스트 (허브)

desktop 의 Paddock 이 **허브**다. 허브는 다른 Paddock(**피어**)을 자기 화면에 합쳐 보여 주고, 피어 쪽 요청을 대신 전달한다. 휴대폰은 허브 하나(`https://desktop.uaru-monster.ts.net`)만 연다.

| 호스트 | 역할 | 주소 | herdr |
| --- | --- | --- | --- |
| desktop (Windows) | 허브, 알림 | `https://desktop.uaru-monster.ts.net` | 0.9.5 |
| server (이 맥북) | 피어 | `https://server.uaru-monster.ts.net:8443` | 0.9.3 |

- 허브는 피어마다 `/api/stream`(SSE)을 구독한다. 끊기면 다시 붙고(1초부터 최대 30초 간격), 6초 안에 돌아오지 않으면 그 피어를 **오프라인**으로 표시하고 그 항목을 목록에서 뺀다. 연결은 됐는데 50초 동안 아무것도 안 오면(노트북이 잠든 경우) 끊은 것으로 본다.
- 허브의 `/api/state`·`/api/stream` 은 모든 호스트를 합친 것이다. 에이전트·터미널·워크스페이스마다 `host`(id)·`hostLabel` 이 붙고, `hosts` 에 호스트별 `online`·`herdr`·`since` 가 들어 있다.
- 호스트별 요청은 `/api/peers/<id>/<나머지>` 로 보내면 허브가 피어의 `/api/<나머지>` 로 넘긴다(`host`, `agents`, `panes`, `workspaces` 만). `X-Paddock` 검사는 허브에서 먼저 하고 피어로도 넘긴다. 피어가 오프라인이면 `503 peer_offline`, 시간 초과는 `504`(조회 15초, 변경 60초).
- 알림은 허브만 보낸다. 피어의 상태 변화(응답 필요, 완료)도 허브가 보고 보낸다. 피어는 `PADDOCK_PUSH=0` 이라 알림을 아예 보내지 않으므로 같은 알림이 두 번 오지 않는다. 피어가 잠든 사이에 생긴 변화도 다시 연결되면 알린다.
  - herdr 0.9.3 은 `completion_seq` 가 없어서, 그 호스트에서는 작업 중 → 완료 로 바뀔 때를 완료로 본다.
- 인증: 피어도 `tailscale serve` 뒤에 있고 `Tailscale-User-Login` 을 `PADDOCK_ALLOWED_LOGINS` 와 맞춘다. desktop 노드는 사용자 소유(태그 없음)라 허브 → 피어 요청에도 `tailscale serve` 가 `kangwonjin.dev@gmail.com` 을 붙인다(직접 확인함; 요청에 위조한 값은 serve 가 덮어쓴다). 그래서 따로 비밀값을 두지 않았다. 피어를 태그 노드로 바꾸면 이 머리글이 사라지므로 그때는 공유 비밀을 넣어야 한다.
- 화면: 목록 위의 호스트 선택(전체 / desktop / server, 이 기기에 기억), 호스트가 둘 이상이면 항목마다 호스트 표시, 오프라인 호스트 알림 줄. 주소는 `#/h/server/agent/w3:p1` 처럼 호스트를 포함한다. 예전 주소(`#/agent/…`)는 허브 자신의 호스트로 연다.

### 환경 변수

| 이름 | 뜻 |
| --- | --- |
| `PADDOCK_ALLOWED_LOGINS` | 허용할 Tailscale 로그인(쉼표). 또는 `PADDOCK_ALLOW_LOCAL=1`(머리글 없는 로컬 접속 허용, 시험용) |
| `PADDOCK_HOST_ID` | 짧은 호스트 id(`desktop`, `server`). 영문 소문자로 시작, `all` 은 못 쓴다 |
| `PADDOCK_HOST_LABEL` | 화면에 보일 이름 |
| `PADDOCK_PEERS` | 허브로 만든다: `id=url` 을 쉼표로. 예 `server=https://server.uaru-monster.ts.net:8443` |
| `PADDOCK_PUSH` | `0` 이면 알림을 보내지 않는다(피어용) |
| `PADDOCK_VAPID_SUBJECT`, `PADDOCK_DATA`, `PORT`, `HOST` | 전과 같음 |

## 운영 — desktop (허브)

- 위치: `C:\Users\kangw\src\paddock`, 로그는 `data\paddock.log`, VAPID 키·구독은 `data\`.
- 시작: 로그온 때 예약 작업 `Paddock` 이 `run.cmd` 를 띄운다(127.0.0.1:8787). 호스트 id·피어 목록도 `run.cmd` 에 있다. `run.cmd` 는 CRLF 로 둔다(LF 면 cmd 가 `set` 줄을 빠뜨린다).
- 공개: `tailscale serve --bg 8787` → `https://desktop.uaru-monster.ts.net` (tailnet 전용).
- 배포: 맥에서 `./deploy.sh` (또는 `./deploy.sh desktop`).

## 운영 — server (이 맥북, 피어)

- 위치: `~/.local/share/paddock` (저장소 밖 배포본), 로그는 `~/.local/share/paddock/data/paddock.log`.
- 시작: LaunchAgent `local.paddock` (`~/Library/LaunchAgents/local.paddock.plist`) 가 `mac/run.sh` 를 띄운다(127.0.0.1:8787, 로그인 때 시작, 죽으면 다시 띄움). 원본은 저장소의 `mac/`.
- 공개: `tailscale serve --bg --https=8443 http://127.0.0.1:8787` → `https://server.uaru-monster.ts.net:8443`. 443 은 이미 다른 것(`/` → 127.0.0.1:18789)이 쓰고 있어서 건드리지 않았다.
- 배포: `./deploy.sh server` (둘 다는 `./deploy.sh all`). 배포본을 rsync 하고 `npm ci` 후 LaunchAgent 를 다시 올리며, 8443 serve 가 없으면 만든다.
- 노트북이 잠들면 허브에 server 가 오프라인으로 보이고, 깨면 저절로 돌아온다.

## 끄기

desktop:

```powershell
tailscale serve --https=443 off
Unregister-ScheduledTask Paddock -Confirm:$false
```

맥(server) — 잠깐 멈추기 / 다시 켜기:

```sh
launchctl bootout gui/$(id -u)/local.paddock
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.paddock.plist
```

맥에서 아주 없애기(다른 serve 설정은 그대로 둔다):

```sh
launchctl bootout gui/$(id -u)/local.paddock
rm ~/Library/LaunchAgents/local.paddock.plist
tailscale serve --https=8443 off
rm -rf ~/.local/share/paddock
```

그다음 desktop `run.cmd` 의 `PADDOCK_PEERS` 줄을 지우고 `./deploy.sh` 하면 허브가 혼자 도는 Paddock 으로 돌아간다(지우지 않아도 server 가 계속 오프라인으로 보일 뿐 동작에는 문제없다).
