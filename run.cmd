@echo off
rem Started at logon by the "Paddock" scheduled task. Logs go to data\paddock.log.
cd /d "%~dp0"
if not exist data mkdir data
set PADDOCK_ALLOWED_LOGINS=kangwonjin.dev@gmail.com
set PADDOCK_HOST_LABEL=desktop
set PADDOCK_VAPID_SUBJECT=https://desktop.uaru-monster.ts.net
rem The task runs without the interactive PATH; point at node directly.
set NODE=C:\Users\kangw\AppData\Local\mise\installs\node\26.3.1\node.exe
"%NODE%" server.js >> data\paddock.log 2>&1
