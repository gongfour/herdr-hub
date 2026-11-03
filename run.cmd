@echo off
rem Started at logon by the "HerdrHub" scheduled task. Logs go to data\herdr-hub.log.
cd /d "%~dp0"
if not exist data mkdir data
set HERDR_HUB_ALLOWED_LOGINS=kangwonjin.dev@gmail.com
set HERDR_HUB_HOST_ID=desktop
set HERDR_HUB_HOST_LABEL=desktop
rem The names this hub answers to (Host header via tailscale serve); anything else gets 403.
set HERDR_HUB_HOSTS=desktop.uaru-monster.ts.net
rem Hub: merge these peers into this Herdr Hub (id=url, comma-separated).
set HERDR_HUB_PEERS=server=https://server.uaru-monster.ts.net:8443
set HERDR_HUB_VAPID_SUBJECT=https://desktop.uaru-monster.ts.net
rem Agents in folders or workspaces named with these prefixes never notify (throwaway test workspaces).
set HERDR_HUB_PUSH_MUTE=hub-
rem The task runs without the interactive PATH; point at node directly.
set NODE=C:\Users\kangw\AppData\Local\mise\installs\node\26.3.1\node.exe
"%NODE%" server.js >> data\herdr-hub.log 2>&1
