# Herdr Hub — 여러 호스트와 운영

여러 호스트를 한 화면에 합치는 법, 환경 변수, 멈추지 않기, 그리고 지은이의 배포 예(desktop·server·macbook). 기능과 구조는 [design.md](design.md).

## 여러 호스트 (허브)

desktop 의 Herdr Hub 이 **허브**다. 허브는 다른 Herdr Hub(**피어**)을 자기 화면에 합쳐 보여 주고, 피어 쪽 요청을 대신 전달한다. 휴대폰은 허브 하나(`https://desktop.example.ts.net`)만 연다.

| 호스트 | 역할 | 주소 | herdr |
| --- | --- | --- | --- |
| desktop (Windows) | 허브, 알림 | `https://desktop.example.ts.net` | 0.9.5 |
| server (Mac) | 피어 | `https://server.example.ts.net:8443` | 0.9.5 |
| macbook (MacBook Air) | 자기 허브 (desktop·server 를 피어로) | `http://localhost:8787` (그 기기에서만) | 0.9.5 |

- macbook 은 들고 다니는 기기라 desktop 허브의 피어가 아니고 자기 허브다: 자기 herdr 의 에이전트에 desktop·server 를 피어로 붙여 함께 보인다(피어 목록의 씨앗은 그 기기 `data/host.env` 의 `HERDR_HUB_PEERS`, 그 뒤로는 설정 → 연결). server·desktop 이 꺼져 있거나 인터넷이 없어도 그 기기의 브라우저에서 `http://localhost:8787` 로 열리고(`HERDR_HUB_ALLOW_LOCAL=1`, loopback 만 로그인 없이), 그동안 두 호스트는 마지막으로 들은 상태로 흐리게 남는다. 알림은 없다. 설정은 그 기기의 `data/host.env`(`mac/run.sh` 가 읽는다, 배포가 덮어쓰지 않는다)에 있고, `./deploy.sh macbook`(ssh)이 처음에 쓴다. `./deploy.sh all` 은 macbook 이 답할 때만 함께 배포한다.

- 피어 목록(`lib/hoststore.js`, 시험은 `npm test`)은 허브의 데이터다: `data/peers.json`(`[{ id, url, label? }]`, 임시 파일에 쓰고 바꿔 끼운다). 설정 → 연결에서 고치고, 바꾸면 다시 시작하지 않아도 그 피어의 연결을 열거나 닫는다. 파일이 없을 때 한 번만 `HERDR_HUB_PEERS` 로 채우고(씨앗), 그 뒤로는 파일이 이긴다 — 호스트 설정(`data\host.cmd`·`data/host.env`)의 줄을 바꿔도 이미 있는 목록은 그대로다(다시 씨앗을 쓰려면 `data/peers.json` 을 지운다). 파일도 씨앗도 없는 호스트는 피어다: 연결 칸이 읽기 전용이고 「호스트는 허브에서 관리합니다」. 피어를 모두 빼도 빈 파일이 남아 허브로 남는다. 손으로 고친 파일에서 맞지 않는 줄은 로그에 남기고 건너뛴다(JSON 이 깨졌으면 `peers.json.bad` 로 두고 빈 목록).
  - 설정 → 연결: 호스트 줄마다 점·이름·herdr·에이전트 수·주소, 피어 줄의 ⋯ → 이름 바꾸기(비우면 피어가 스스로 쓰는 이름) / 주소 바꾸기(곧바로 새 주소로 다시 붙고 연결 시험) / 연결 시험 / 빼기(확인). 「호스트 추가」 는 이름·주소 칸과 「연결 시험」, 「추가」(시험하지 않았으면 먼저 시험하고, 실패하면 「그래도 추가」 — 잠든 피어도 넣을 수 있다). 새 호스트의 id(주소 `#/h/<id>/…`)는 연결 시험에서 그 호스트가 밝힌 자기 id, 없으면 이름, 없으면 주소의 첫 이름이다. 주소는 바꿀 수 있고 id 는 그대로다.
  - API(허브 자신의 것, `/api/peers/<id>/…` 로는 넘기지 않는다): `GET /api/hosts` → `{manageable, self, max, peers}`, `POST /api/hosts {id, url, label}`, `POST /api/hosts/<id>/rename {label}`, `POST /api/hosts/<id>/url {url}`, `POST /api/hosts/<id>/remove`, `POST /api/hosts/test {url}` → `{url, ok, code, id, label, herdr, api, apiMatch, version}`. 바꾸는 것은 다른 변경과 같은 검사(Host 허용 목록, 로그인, `X-Herdr-Hub`)를 거치고, 허브가 아니면 `409 not_hub`. 오류: `bad_url`, `bad_host_id`, `host_is_self`, `host_id_taken`, `host_url_taken`, `bad_label`, `too_many_hosts`(16), `unknown_host`.
  - 연결 시험은 그 주소의 `/api/version` 과 `/api/host` 를 묻는다. `code`: `ok`, `timeout`, `dns`, `refused`, `tls`, `redirect`, `bad_host`(그쪽 `HERDR_HUB_HOSTS` 에 없는 이름, 403), `forbidden`(그쪽이 이 로그인을 막음), `http`(예: tailscale serve 의 502 — 노드는 있는데 Herdr Hub 가 꺼짐), `not_hub`, `self`.
  - 보안: 피어를 더하면 허브가 사람이 적은 주소로 요청을 보낸다. 그래서 주소는 http(s) 출처만(경로·쿼리·로그인 없이, 스킴이 없으면 https), 리다이렉트는 따라가지 않고(그대로 `redirect` 라고 알린다), 5초 제한·64KB 까지만 읽는다. 허브 자신에게는 tailnet 기기만 닿는다(`tailscale serve`, 지금까지와 같은 모델). 새로 넘겨 주는 경로는 없다(피어 프록시는 그대로).
- 허브가 안 될 때(`public/conn.js`, 시험은 `npm test`): 앱은 이 기기의 `herdr-hub.hosts`(localStorage)에 마지막으로 본 호스트와 그 주소(허브는 지금 페이지의 출처, 피어는 `state.hosts[].url`)를 적어 둔다. 실시간 연결이 10초 넘게 끊겼고 `/api/version` 도 안 되면(배포의 재시작은 그 안에 돌아온다; tailscale serve 의 502 도 안 되는 것으로 본다) 맨 위에 「허브(desktop)에 연결할 수 없습니다」와 먼저 볼 것(「이 기기의 Tailscale 이 켜져 있는지 확인하세요」), 기억한 피어 가운데 지금 답하는 것마다 「server 로 직접 열기」, 「다시 시도」를 띄운다. 돌아오면 저절로 사라진다. 제목과 「다시 시도」가 한 줄이고, 먼저 볼 것은 「먼저 볼 것」(`<details>`) 안에 있어 처음 뜰 때는 펼쳐져 있다가 12초 뒤 접힌다(폰 화면의 4분의 1을 계속 차지하지 않게; 다시 펼치면 그대로 둔다). 「desktop 컴퓨터가」처럼 이름 뒤에 「컴퓨터」를 넣어 조사를 맞춘다.
  - 실시간 연결이 끊긴 동안(`app.js` liveDot/liveChip): 작업공간·에이전트·셸·워크스페이스 머리글에 빨간 칩 하나가 같은 모양으로 뜬다(목록은 「연결 끊김」·「연결 중」·「herdr 연결 끊김」, 나머지는 「끊김」). 누르면 알림 줄로 뜻(「실시간 연결이 끊겨 다시 붙는 중입니다…」)을 말한다. 정상일 때는 아무것도 없다(예전의 「● 실시간」은 없앴다). 끊김을 알아챈 순간(`onerror`, 앞으로 돌아왔을 때의 `revive`) 보이는 머리글을 모두 다시 그린다.
  - 알림 줄(토스트, `core.js` toast): 상자는 처음부터 페이지에 있는 `aria-live="polite"` 영역이고 오류만 `role=alert`. 누르거나 아래로 밀면 닫힌다. 단추가 있는 알림 줄(다시 보내기 등)은 손대거나 다른 화면으로 갈 때까지 남고 × 가 있다. 실패는 무엇을 못 했는지 말한다(「워크스페이스를 닫지 못했습니다: …」, `act()` 의 넷째 인자). 어두운 모드에서는 카드보다 한 단계 밝은 면·테두리·짙은 그림자로 뜬다.
  - 시트(`core.js` sheet): 본문이 대화상자 설명(`aria-describedby`)이다. 입력 칸은 열 때 지금 값을 골라 두고(치면 바뀐다), 칸 안 ⓧ 로 비운다. 무엇을 친 뒤에는 바깥을 눌러도 닫히지 않는다(취소·Esc·뒤로로 닫는다). 오류 문구(`.hint`)는 빨갛고, `aria-invalid` 칸은 포커스 중에도 빨간 테두리다(에이전트 시작·새 워크스페이스 양식도 같다). 어두운 모드의 덮개는 더 짙고 시트 위에 테두리가 있다.
  - 새 버전: 보통은 설정 아이콘의 점(「작업공간」의 「새 결과」 점과 같은 모양, 놓인 아이콘이 뜻을 가른다; 숫자도 앱 아이콘 배지도 없다). 띠는 API 가 다를 때만: 머리줄과 같은 바탕에 주황 점과 글이 왼쪽 앞(머리글 제목과 같은 16px)에, 「새로고침」(44px)이 바로 뒤에, 닫기는 없다(미룰 수 없는 일이고, 안전해지는 대로 저절로 다시 열린다).
  - 답하는지는 브라우저가 그 피어의 `GET /api/version` 을 직접 묻는다(3.5초, 자격 증명 없이). 그래서 `/api/version` 하나만 CORS 로 읽게 했다(`Access-Control-Allow-Origin` 은 같은 tailnet 의 https 출처 — `HERDR_HUB_HOSTS` 의 첫 이름 뒤 도메인, 비었으면 `*.ts.net` — 와 `HERDR_HUB_ALLOW_LOCAL` 일 때 loopback 만, `*` 는 쓰지 않음). 빌드 정보뿐이라 열어도 되고, 확인 없이 링크만 주면 잠든 피어로 보내게 되기 때문이다.
  - 앱의 페이지조차 받지 못할 때(Tailscale 이 꺼졌거나 desktop 이 잠들어 연결이 안 되거나 502·503·504)는 서비스 워커가 브라우저 오류 화면 대신 `offline.html` 을 보여 준다(같은 안내와 단추). 서비스 워커는 이것과 그 파일(`conn.js`, `style.css`)만 캐시하고, 페이지를 받을 때 한 시간에 한 번 새로 받는다. API·실시간 연결·다른 파일은 전처럼 네트워크로만 간다.
  - 직접 연 피어는 다른 출처다: 그 호스트의 에이전트만 보이고, 설치한 앱·설정·알림·보관한 대화가 따로다(필요하면 그 주소로 따로 설치한다).
- 허브는 피어마다 `/api/stream`(SSE)을 구독한다. 끊기면 다시 붙고(1초부터 최대 30초 간격), 6초 안에 돌아오지 않으면 그 피어를 **오프라인**으로 표시한다. 연결은 됐는데 50초 동안 아무것도 안 오면(노트북이 잠든 경우) 끊은 것으로 본다.
- 오프라인 피어의 항목은 빼지 않고 **마지막으로 본 모습**(유령)으로 남긴다(`lib/peers.js` staleView). 항목마다 `stale`(마지막으로 들은 때, ping 포함)이 붙고 에이전트의 `status` 는 `'stale'`, 원래 상태는 `lastStatus` 에 둔다. 그래서 답 필요 수·배지·새 결과·답하기·알림은 유령을 세지 않는다. 호스트에는 `staleAt`. 화면: 카드와 줄이 흐린 회색, 카드에 「오후 10:47 기준」, 줄의 점은 속 빈 회색 고리와 「마지막: 작업 중」. 목록 위에 따로 알림 줄은 없다: 그 호스트의 점이 빨갛다. 에이전트를 열면 마지막 대화를 읽기만 한다(머리글 아래 띠, 입력 칸은 닫히고 「server 가 돌아오면 보낼 수 있습니다」). 대화는 이 기기에 남은 것, 없으면 허브가 피어 대화를 넘기며 담아 둔 마지막 창(최근 32개, `lib/routes/peers.js` lastChats), 둘 다 없으면 그렇다고 말한다. 메뉴의 바꾸는 항목(끝내기·이름·키·터미널·새 셸 …)은 까닭과 함께 꺼지고, 키·명령으로 해도 알림만 뜬다(`actions.js` ghostOff·ghostRefuse). 피어가 돌아오면 다음 상태가 그 자리를 그대로 바꾼다. 유령은 `data/peer-ghosts.json` 에 30초마다 많아야 한 번 적어 두어, 피어가 잠든 동안 허브를 배포·재시작해도 남는다(3일 지나거나 주소가 바뀐 피어의 것은 버린다).
- 허브의 `/api/state`·`/api/stream` 은 모든 호스트를 합친 것이다. 에이전트·터미널·워크스페이스마다 `host`(id)·`hostLabel` 이 붙고, `hosts` 에 호스트별 `online`·`herdr`·`since`(피어는 허브가 따라가는 주소 `url` 도)가 들어 있다. `/api/host` 는 `herdr` 상태도 준다.
- 호스트별 요청은 `/api/peers/<id>/<나머지>` 로 보내면 허브가 피어의 `/api/<나머지>` 로 넘긴다(`host`, `dirs`, `agents`, `panes`, `workspaces`, `uploads` 만). 본문은 이진 그대로 오간다(사진 업로드는 10MB, 나머지는 256KB 까지). `X-Herdr-Hub` 검사는 허브에서 먼저 하고 피어로도 넘긴다. 피어가 오프라인이면 `503 peer_offline`, 시간 초과는 `504`(조회 15초, 변경 60초).
- 알림 내용(`lib/notify.js`, 시험은 `npm test`): 에이전트마다 `tag` 하나(`host|pane`)라 새 상태가 옛 알림을 바꾼다.
  - 답 필요: 허브가 화면을 읽어(피어 것은 피어에게 물어) 본문에 무엇을·질문·선택지를 짧게 넣는다. 예 「Bash: echo hi > note.txt / 진행할까요? 1 Yes · 2 Always · 3 Auto mode · 4 No」. `renotify` 를 켠다.
  - 완료: 마지막 답의 첫 줄과 「호스트 · 워크스페이스」. 조용히 바꾼다.
  - 알림 버튼: 답 필요에 빠른 답 2개까지(첫 답과 거절, 예 Yes · No; 「Type something」 은 빼고 빠른 답 버튼과 같은 규칙). 누르면 서비스 워커가 `POST /api/answer {host, pane, stateSeq, n, label}` 을 보낸다(같은 출처라 tailscale serve 가 로그인 머리글을 붙이고, `X-Herdr-Hub` 도 붙인다). 허브는 그 호스트의 `POST /api/agents/<pane>/answer` 로 넘기고, 그 호스트는 herdr 상태를 새로 읽어 그 에이전트가 아직 같은 `stateSeq` 로 막혀 있고 화면의 n 번 선택지 이름이 같을 때만 키를 보낸다(아니면 `409 stale`·`not_blocked`·`no_choices`). 보낸 뒤 같은 자리에 「보냄: Yes」(소리 없음)를 4초 띄운다.
  - 버튼은 브라우저가 지원할 때만 보인다(`Notification.maxActions`). iPhone·iPad Safari 웹 푸시는 버튼이 없어서 알림을 누르면 그 에이전트가 열린다. 설정의 알림 칸이 이 기기에 버튼이 붙는지 말한다.
  - 앱에서 답하거나 에이전트를 열면 그 에이전트의 알림을 닫는다(`getNotifications({tag})`).
  - `HERDR_HUB_PUSH_MUTE`(쉼표로 이은 앞글자): 폴더나 워크스페이스 이름이 그렇게 시작하는 에이전트는 알리지 않는다(로그에 `muted`). 예: 시험용 워크스페이스의 앞글자 `hub-`.
- 알림은 허브만 보낸다. 피어의 상태 변화(응답 필요, 완료)도 허브가 보고 보낸다. 피어는 `HERDR_HUB_PUSH=0` 이라 알림을 아예 보내지 않으므로 같은 알림이 두 번 오지 않는다. 피어가 잠든 사이에 생긴 변화도 다시 연결되면 알린다.
  - herdr 0.9.3 은 `completion_seq` 가 없어서, 그 호스트에서는 작업 중 → 완료 로 바뀔 때를 완료로 본다.
- 인증: 피어도 `tailscale serve` 뒤에 있고 `Tailscale-User-Login` 을 `HERDR_HUB_ALLOWED_LOGINS` 와 맞춘다. desktop 노드는 사용자 소유(태그 없음)라 허브 → 피어 요청에도 `tailscale serve` 가 `you@example.com` 을 붙인다(직접 확인함; 요청에 위조한 값은 serve 가 덮어쓴다). 그래서 따로 비밀값을 두지 않았다. 피어를 태그 노드로 바꾸면 이 머리글이 사라지므로 그때는 공유 비밀을 넣어야 한다.
- 화면: 목록 위의 호스트 선택(전체 / desktop / server, 이 기기에 기억; 호스트 점은 온라인이면 초록에 고리가 2.4초마다 점의 두 배가 안 되게 퍼지고(켜질 때 — 페이지를 열 때나 다시 연결될 때 — 한 번 살짝 튀며 2.4배까지 퍼진다; 더 크게 퍼지면 과했다), 끊기면(오프라인, 또는 herdr 가 답하지 않음) 빨간 점으로 멈추고 이름이 흐려진다. 허브가 막 켜져 아직 그 피어에 닿는 중이면 회색 고리가 깜박인다(재시작 때 빨갛게 번쩍이지 않게; 들은 적이 있거나 실패했으면 오프라인). 끊긴 이유와 때(「오프라인 · 19:58부터」·「herdr 연결 끊김」)는 그 단추의 툴팁에 있고, 목록 위에 따로 알림 줄을 두지 않는다(예전의 붉은 알림 상자는 재시작 몇 초에도 떠서 너무 컸다). 그 호스트만 고른 화면에 카드가 하나도 없을 때만 가운데 한 줄(「desktop 오프라인입니다 · 19:58부터」와 「연결 상태 보기」). 설정 → 연결의 점도 같다(`list.js` hostDot, `rowtext.js` hostState; 동작 줄이기·숨은 페이지에서는 움직이지 않는다), 스크린리더에는 「server, 오프라인」·「…, API 버전 다름, 배포 필요」로 읽힌다), 호스트가 둘 이상이면 항목마다 호스트 표시. 주소는 `#/h/server/agent/w3:p1` 처럼 호스트를 포함한다. 예전 주소(`#/agent/…`)는 허브 자신의 호스트로 연다.

### 환경 변수

| 이름 | 뜻 |
| --- | --- |
| `HERDR_HUB_ALLOWED_LOGINS` | 허용할 Tailscale 로그인(쉼표). 또는 `HERDR_HUB_ALLOW_LOCAL=1`(머리글 없는 로컬 접속 허용, 시험용) |
| `HERDR_HUB_HOSTS` | 이 Herdr Hub 의 이름(쉼표, `Host` 머리글 그대로). `tailscale serve` 는 브라우저의 Host 를 그대로 넘긴다(desktop `desktop.example.ts.net`, server `server.example.ts.net:8443`, 둘 다 확인함). 다른 Host 는 로그인 검사 전에 `403 bad_host` — 자기 도메인을 127.0.0.1 로 돌린 페이지(DNS rebinding)를 막는다. 포트 없는 이름은 `:443` 도 받는다. 비우면 `*.ts.net` 아무 이름. `127.0.0.1:PORT`·`localhost:PORT` 는 `HERDR_HUB_ALLOW_LOCAL=1` 일 때만 |
| `HERDR_HUB_HOST_ID` | 짧은 호스트 id(`desktop`, `server`). 영문 소문자로 시작, `all` 은 못 쓴다 |
| `HERDR_HUB_HOST_LABEL` | 화면에 보일 이름 |
| `HERDR_HUB_PEERS` | 허브로 만든다: `id=url` 을 쉼표로. 예 `server=https://server.example.ts.net:8443`. `data/peers.json` 이 없을 때 한 번만 쓰는 씨앗이고, 그 뒤 목록은 설정 → 연결에서 고친다(위) |
| `HERDR_HUB_PUSH` | `0` 이면 알림을 보내지 않는다(피어용) |
| `HERDR_HUB_PUSH_MUTE` | 알리지 않을 폴더·워크스페이스 이름 앞글자(쉼표). 시험 워크스페이스용 |
| `HERDR_HUB_WATCHDOG_MS` | 메인 스레드가 이만큼(기본 30000 ms) 멈춰 있으면 감시 스레드가 프로세스를 죽여 다시 뜨게 한다(아래 「멈추지 않기」). `0` 이면 끈다 |
| `HERDR_HUB_AWAKE_MS` | 셸을 쓰는 동안 이 호스트의 herdr 에 `ping` 을 보내는 간격(기본 50 ms, 아래쪽 한계 10; 연결 도우미가 호출을 나르는 동안은 쉰다). `0` 이면 끄고 키 앞의 `ping` 도 끈다(예: desktop). [design.md](design.md) 「herdr 깨워 두기」 |
| `HERDR_HUB_LIVE_IDLE_MS` | 셸의 실시간 연결이 열려 있고 아무것도 움직이지 않을 때 화면을 읽는 간격(기본 150 ms; 연결 도우미를 끈 Mac 은 40 — herdr 를 깨워 둔다). [design.md](design.md) 「셸의 실시간 연결」 |
| `HERDR_HUB_LIVE_PING_MS` | 셸의 실시간 연결에 서버가 WebSocket ping 을 보내는 간격(기본 15000 ms). 그 세 배 동안 아무것도 안 오면 닫는다. [design.md](design.md) 「셸의 실시간 연결」 |
| `HERDR_HUB_HERDR_HELPER` | herdr 연결 도우미: `1` 켬, `0` 끔(기본: Mac 에서만 켬). [design.md](design.md) 「herdr 연결 도우미」 |
| `HERDR_HUB_PYTHON` | 도우미를 돌릴 파이썬(기본 `/usr/bin/python3`) |
| `HERDR_HUB_VAPID_SUBJECT`, `HERDR_HUB_DATA`, `PORT`, `HOST` | 전과 같음 |

### 멈추지 않기

2026-11-05 server 에서 Hub 가 0% CPU 로 아무것도 답하지 않았다: `@` 파일 제안이 `/` 부터 동기 `readdir` 로 걷다가 macOS 가 지키는 폴더에서 영영 멈췄고, 프로세스는 살아 있어서 launchd 가 다시 띄우지 않았다. 그래서:

- 요청을 받는 길에서 남의 폴더(에이전트 cwd, `~/.claude`, 대화 기록, 폴더 찾아보기)는 `lib/fsq.js` 로만 읽는다: 비동기, 요청마다 시간 예산(`@` 파일 2 초, 명령 목록 3 초, 폴더 4 초 …). 예산이 다하면 그때까지 찾은 것을 `partial: true` 로 돌려준다(폴더 찾아보기는 `denied`·`slow`). 1.5 초 넘게 안 끝나는 호출은 「막힘」으로 치고 그 경로는 끝날 때까지 건너뛴다. 동시에 4 개, 막힌 것은 8 개까지(각각 libuv 스레드 하나를 잡는다; 스레드 수 `UV_THREADPOOL_SIZE=16` 은 `server.js`·`mac/run.sh`·`run.cmd` 가 정한다). `/`·홈·그 위 폴더는 아예 걷지 않는다(`tooWide`).
- 감시 스레드(`lib/watchdog.js`): 메인 스레드가 1 초마다 심장박동을 남기고, 30 초 동안 없으면 마지막으로 시작한 요청(메서드·경로)을 로그에 한 줄 남기고 SIGKILL. server 는 launchd KeepAlive 가, desktop 은 `run.cmd` 의 반복(종료 코드 0·2 가 아니면 10 초 뒤 다시)이 다시 띄운다 — 예약 작업의 「실패 시 다시 시작」은 0 이 아닌 종료 코드로는 움직이지 않는다.
- 로그: `fs stuck: <경로>`, `@-files: not walking <cwd>`, `@-files: walk of <cwd> partial`, 3 초 넘은 요청 `slow request <메서드> <경로> <ms>`(쿼리·본문 없음), `watchdog: main thread silent …`.

## 운영 — desktop (허브)

- 위치: `%USERPROFILE%\src\herdr-hub`, 로그는 `data\herdr-hub.log`, VAPID 키·구독은 `data\`.
- 시작: 로그온 때 예약 작업 `HerdrHub` 가 `conhost.exe --headless run.cmd` 로 창 없이 띄운다(127.0.0.1:8787). 콘솔 창으로 띄우면 그 창을 닫거나 Ctrl+C 가 눌리는 순간 서버가 꺼진다(종료 코드 0xC000013A). node 가 죽으면(멈춰서 감시 스레드가 죽인 것도) `run.cmd` 가 10 초 뒤 다시 띄운다(종료 코드 0·2 면 끝). 이 호스트의 설정(로그인·이름·피어 목록의 씨앗·node 경로)은 `data\host.cmd` 의 `set` 줄들이고(`run.cmd` 맨 위 주석에 예, git 에 넣지 않고 배포가 덮어쓰지 않는다), 피어 목록은 `data\peers.json`(설정 → 연결에서 고친다). `run.cmd` 는 CRLF 로 둔다(LF 면 cmd 가 `set` 줄을 빠뜨린다).
- 공개: `tailscale serve --bg 8787` → `https://desktop.example.ts.net` (tailnet 전용).
- 배포: 맥에서 `./deploy.sh` (또는 `./deploy.sh desktop`). 어느 호스트로 보내는지(ssh 대상, 배포 폴더, serve 이름)는 저장소의 `deploy.env`(git 에 넣지 않는다, `deploy.sh` 맨 위 주석)에 둔다.

## 운영 — server (Mac, 피어)

- 위치: `~/.local/share/herdr-hub` (저장소 밖 배포본), 로그는 `~/.local/share/herdr-hub/data/herdr-hub.log`.
- 시작: LaunchAgent `local.herdr-hub` (`~/Library/LaunchAgents/local.herdr-hub.plist`) 가 `mac/run.sh` 를 띄운다(127.0.0.1:8787, 로그인 때 시작, 죽으면 다시 띄움 — 멈추면 감시 스레드가 죽인다). 원본은 저장소의 `mac/`. 이 호스트의 설정은 `data/host.env`(`mac/run.sh` 맨 위 주석에 예; macbook 도 같다).
- 공개: `tailscale serve --bg --https=8443 http://127.0.0.1:8787` → `https://server.example.ts.net:8443`. 443 은 이미 다른 것(`/` → 127.0.0.1:18789)이 쓰고 있어서 건드리지 않았다.
- 배포: `./deploy.sh server` (둘 다는 `./deploy.sh all`). 어느 쪽이든 먼저 `build.json` 을 찍어 함께 보내고 끝나면 지운다. 배포본을 rsync 하고 `npm ci` 후 LaunchAgent 를 다시 올리며, 8443 serve 가 없으면 만든다.
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

그다음 허브의 설정 → 연결에서 server 의 ⋯ → 빼기(빼지 않아도 server 가 계속 오프라인으로 보일 뿐 동작에는 문제없다). 허브 설정의 `HERDR_HUB_PEERS` 는 씨앗일 뿐이라 지우지 않아도 된다.
