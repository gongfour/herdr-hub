@echo off
rem Started at logon by the "HerdrHub" scheduled task. Logs go to data\herdr-hub.log.
cd /d "%~dp0"
if not exist data mkdir data
set HERDR_HUB_ALLOWED_LOGINS=kangwonjin.dev@gmail.com
set HERDR_HUB_HOST_ID=desktop
set HERDR_HUB_HOST_LABEL=desktop
rem The names this hub answers to (Host header via tailscale serve); anything else gets 403.
set HERDR_HUB_HOSTS=desktop.uaru-monster.ts.net
rem Hub: the peers to merge in (id=url, comma-separated). Only a seed: used once, when data\peers.json
rem does not exist yet; after that the list lives there and is edited in Settings > Connection.
set HERDR_HUB_PEERS=server=https://server.uaru-monster.ts.net:8443
set HERDR_HUB_VAPID_SUBJECT=https://desktop.uaru-monster.ts.net
rem Agents in folders or workspaces named with these prefixes never notify (throwaway test workspaces).
set HERDR_HUB_PUSH_MUTE=hub-
rem The task runs without the interactive PATH; point at node directly.
set NODE=C:\Users\kangw\AppData\Local\mise\installs\node\26.3.1\node.exe
rem Pool threads for filesystem calls that may hang (lib/fsq.js).
set UV_THREADPOOL_SIZE=16
rem A node that died (or that its watchdog killed when it froze, lib/watchdog.js) is started again
rem here: the task itself does not restart an action that exited. Exit 0 (stopped on purpose) and
rem 2 (bad settings) end the loop. deploy.sh stops this cmd before its node.
:run
"%NODE%" server.js >> data\herdr-hub.log 2>&1
set CODE=%ERRORLEVEL%
if "%CODE%"=="0" exit /b 0
if "%CODE%"=="2" exit /b 2
echo %DATE% %TIME% run.cmd: node exited with %CODE%, starting it again in 10 s>> data\herdr-hub.log
ping -n 11 127.0.0.1 >nul
goto run
