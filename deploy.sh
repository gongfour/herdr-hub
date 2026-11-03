#!/bin/sh
# Deploy Herdr Hub. node_modules and data/ stay on each host.
#   ./deploy.sh            desktop (Windows hub, scheduled task "HerdrHub")
#   ./deploy.sh server     this Mac (LaunchAgent local.herdr-hub, ~/.local/share/herdr-hub)
#   ./deploy.sh all        both
set -e
cd "$(dirname "$0")"
target="${1:-desktop}"

deploy_desktop() {
  COPYFILE_DISABLE=1 tar --exclude=node_modules --exclude=data --exclude=.git --exclude=deploy.sh --exclude=mac -czf /tmp/herdr-hub-deploy.tgz .
  scp -q /tmp/herdr-hub-deploy.tgz kangw@desktop:C:/Users/kangw/src/herdr-hub-deploy.tgz
  rm /tmp/herdr-hub-deploy.tgz
  ssh kangw@desktop 'Set-Location C:\Users\kangw\src\herdr-hub; tar -xzf ..\herdr-hub-deploy.tgz; Remove-Item ..\herdr-hub-deploy.tgz; Stop-ScheduledTask HerdrHub; Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; npm ci --silent --omit=dev 2>&1 | Out-Null; Start-ScheduledTask HerdrHub; Start-Sleep 3; (Get-ScheduledTask HerdrHub).State'
}

deploy_server() {
  dir="${HERDR_HUB_DIR:-$HOME/.local/share/herdr-hub}"
  node_bin="$HOME/.local/share/mise/installs/node/22.22.0/bin"
  plist="$HOME/Library/LaunchAgents/local.herdr-hub.plist"
  mkdir -p "$dir/data"
  rsync -a --delete --exclude=node_modules --exclude=data --exclude=.git --exclude=deploy.sh --exclude=run.cmd ./ "$dir/"
  (cd "$dir" && PATH="$node_bin:$PATH" npm ci --silent --omit=dev >/dev/null)
  sed "s#__DIR__#$dir#g" mac/local.herdr-hub.plist > "$plist"
  launchctl bootout "gui/$(id -u)/local.herdr-hub" 2>/dev/null || true
  # bootout returns before the job is gone; bootstrapping too early fails with EIO.
  for _ in 1 2 3 4 5 6 7 8 9 10; do launchctl print "gui/$(id -u)/local.herdr-hub" >/dev/null 2>&1 || break; sleep 0.5; done
  launchctl bootstrap "gui/$(id -u)" "$plist"
  sleep 2
  launchctl print "gui/$(id -u)/local.herdr-hub" | grep -E '^\s+(state|pid) ='
  # HTTPS 8443 on this node -> Herdr Hub. 443 is left alone: it already serves something else.
  tailscale serve status --json | grep -q '"server.uaru-monster.ts.net:8443"' || tailscale serve --bg --https=8443 http://127.0.0.1:8787
}

case "$target" in
  desktop) deploy_desktop ;;
  server) deploy_server ;;
  all) deploy_server; deploy_desktop ;;
  *) echo "usage: $0 [desktop|server|all]" >&2; exit 2 ;;
esac
