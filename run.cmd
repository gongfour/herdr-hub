@echo off
rem Herdr Hub on Windows, started at logon by a scheduled task (docs/operations.md). Logs go to
rem data\herdr-hub.log.
rem This host's settings (logins, host names, peers, node) are in data\host.cmd: lines of
rem "set NAME=value", kept across deploys (data\ is never copied over) and not in git. An example:
rem   set HERDR_HUB_ALLOWED_LOGINS=you@example.com
rem   set HERDR_HUB_HOST_ID=desktop
rem   set HERDR_HUB_HOSTS=desktop.example.ts.net
rem   set HERDR_HUB_PEERS=server=https://server.example.ts.net:8443
rem   set HERDR_HUB_VAPID_SUBJECT=https://desktop.example.ts.net
rem   set NODE=C:\path\to\node.exe
cd /d "%~dp0"
if not exist data mkdir data
rem The task runs without the interactive PATH: data\host.cmd may point at node directly.
set NODE=node
rem Pool threads for filesystem calls that may hang (lib/fsq.js).
set UV_THREADPOOL_SIZE=16
if exist data\host.cmd call data\host.cmd
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
