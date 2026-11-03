#!/bin/sh
# Deploy Paddock. node_modules and data/ stay on each host.
#   ./deploy.sh            desktop (Windows hub, scheduled task "Paddock")
#   ./deploy.sh server     this Mac (LaunchAgent local.paddock, ~/.local/share/paddock)
#   ./deploy.sh all        both
set -e
cd "$(dirname "$0")"
target="${1:-desktop}"

deploy_desktop() {
  COPYFILE_DISABLE=1 tar --exclude=node_modules --exclude=data --exclude=.git --exclude=deploy.sh --exclude=mac -czf /tmp/paddock-deploy.tgz .
  scp -q /tmp/paddock-deploy.tgz kangw@desktop:C:/Users/kangw/src/paddock-deploy.tgz
  rm /tmp/paddock-deploy.tgz
  ssh kangw@desktop 'Set-Location C:\Users\kangw\src\paddock; tar -xzf ..\paddock-deploy.tgz; Remove-Item ..\paddock-deploy.tgz; Stop-ScheduledTask Paddock; Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; npm ci --silent --omit=dev 2>&1 | Out-Null; Start-ScheduledTask Paddock; Start-Sleep 3; (Get-ScheduledTask Paddock).State'
}

deploy_server() {
  dir="${PADDOCK_DIR:-$HOME/.local/share/paddock}"
  node_bin="$HOME/.local/share/mise/installs/node/22.22.0/bin"
  plist="$HOME/Library/LaunchAgents/local.paddock.plist"
  mkdir -p "$dir/data"
  rsync -a --delete --exclude=node_modules --exclude=data --exclude=.git --exclude=deploy.sh --exclude=run.cmd ./ "$dir/"
  (cd "$dir" && PATH="$node_bin:$PATH" npm ci --silent --omit=dev >/dev/null)
  sed "s#__DIR__#$dir#g" mac/local.paddock.plist > "$plist"
  launchctl bootout "gui/$(id -u)/local.paddock" 2>/dev/null || true
  # bootout returns before the job is gone; bootstrapping too early fails with EIO.
  for _ in 1 2 3 4 5 6 7 8 9 10; do launchctl print "gui/$(id -u)/local.paddock" >/dev/null 2>&1 || break; sleep 0.5; done
  launchctl bootstrap "gui/$(id -u)" "$plist"
  sleep 2
  launchctl print "gui/$(id -u)/local.paddock" | grep -E '^\s+(state|pid) ='
  # HTTPS 8443 on this node -> Paddock. 443 is left alone: it already serves something else.
  tailscale serve status --json | grep -q '"server.uaru-monster.ts.net:8443"' || tailscale serve --bg --https=8443 http://127.0.0.1:8787
}

case "$target" in
  desktop) deploy_desktop ;;
  server) deploy_server ;;
  all) deploy_server; deploy_desktop ;;
  *) echo "usage: $0 [desktop|server|all]" >&2; exit 2 ;;
esac
