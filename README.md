# Paddock

herdr 에이전트를 휴대폰에서 보고 답하는 웹앱(PWA). herdr가 도는 호스트에서 돌고, Tailscale 로만 접속한다.

- 서버: `server.js` — herdr API 소켓(Windows 는 named pipe)에 직접 붙는다. SSH·셸을 거치지 않는다.
- 화면: `public/` — 빌드 없는 바닐라 JS. 목록(응답 필요 → 완료 → 작업 중 → 대기), 대화(Claude 기록), 화면(터미널), 응답 키, 보내기, 중단(Esc), 웹 푸시 알림.

## 운영 (desktop)

- 위치: `C:\Users\kangw\src\paddock`, 로그는 `data\paddock.log`, VAPID 키·구독은 `data\`.
- 시작: 로그온 때 예약 작업 `Paddock` 이 `run.cmd` 를 띄운다(127.0.0.1:8787).
- 공개: `tailscale serve --bg 8787` → `https://desktop.uaru-monster.ts.net` (tailnet 전용).
- 인증: `tailscale serve` 가 넣는 `Tailscale-User-Login` 이 `PADDOCK_ALLOWED_LOGINS` 에 있어야 한다.
- 배포: 맥에서 `./deploy.sh`.

## 끄기

```powershell
tailscale serve --https=443 off
Unregister-ScheduledTask Paddock -Confirm:$false
```
