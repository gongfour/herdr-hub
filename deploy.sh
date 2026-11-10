#!/bin/sh
# Deploy Herdr Hub. node_modules and data/ stay on each host.
#   ./deploy.sh            desktop (Windows hub, scheduled task "HerdrHub")
#   ./deploy.sh server     this Mac (LaunchAgent local.herdr-hub, ~/.local/share/herdr-hub)
#   ./deploy.sh macbook    the MacBook Air over ssh (same LaunchAgent; its own hub with desktop and
#                          server as peers, opened at http://localhost:8787, so it works offline;
#                          settings in data/host.env)
#   ./deploy.sh all        desktop and server, then macbook if it answers
#
# Where they are comes from deploy.env next to this script (shell assignments, not in git):
#   DESKTOP_SSH=user@desktop              ssh target of the Windows host
#   DESKTOP_DIR='C:\Users\user\src\herdr-hub'   the deploy copy there (its parent holds the upload)
#   SERVER_SERVE=server.example.ts.net:8443   this Mac's tailscale serve name for port 8443
#   MACBOOK_SSH=macbook                   ssh target of the laptop
# Each host's own settings (logins, names, peers) are in its data/ (run.cmd, mac/run.sh).
set -e
cd "$(dirname "$0")"
target="${1:-desktop}"
[ -f deploy.env ] && . ./deploy.env
need() { eval "[ -n \"\${$1}\" ]" || { echo "deploy.env: set $1" >&2; exit 2; }; }

# The build name the hosts show (lib/build.js): package.json's major.minor and the commit count,
# the commit and its time, and whether the tree has uncommitted changes. Shipped as build.json
# (git-ignored; the hosts have no .git), removed again afterwards.
stamp_build() {
  base=$(node -p 'require("./package.json").version.split(".").slice(0, 2).join(".")')
  dirty=false
  [ -z "$(git status --porcelain)" ] || dirty=true
  printf '{ "version": "%s.%s", "commit": "%s", "sha": "%s", "time": "%s", "dirty": %s }\n' \
    "$base" "$(git rev-list --count HEAD)" "$(git rev-parse --short=7 HEAD)" "$(git rev-parse HEAD)" "$(git log -1 --format=%cI)" "$dirty" > build.json
  echo "build $(cat build.json)"
}
stamp_build
trap 'rm -f build.json' EXIT

deploy_desktop() {
  # cmd reads a batch file by offset: a run.cmd left running would go on in the new file once its
  # node is stopped and start node again with the old settings. It goes first.
  need DESKTOP_SSH
  need DESKTOP_DIR
  COPYFILE_DISABLE=1 tar --exclude=node_modules --exclude=data --exclude=.git --exclude=deploy.sh --exclude=deploy.env --exclude=mac -czf /tmp/herdr-hub-deploy.tgz .
  scp -q /tmp/herdr-hub-deploy.tgz "$DESKTOP_SSH:$(dirname "$(printf '%s' "$DESKTOP_DIR" | tr '\\' /)")/herdr-hub-deploy.tgz"
  rm /tmp/herdr-hub-deploy.tgz
  ssh "$DESKTOP_SSH" "Set-Location '$DESKTOP_DIR'; "'tar -xzf ..\herdr-hub-deploy.tgz; Remove-Item ..\herdr-hub-deploy.tgz; Stop-ScheduledTask HerdrHub; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "herdr-hub\\run.cmd" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; npm ci --silent --omit=dev 2>&1 | Out-Null; Start-ScheduledTask HerdrHub; Start-Sleep 3; (Get-ScheduledTask HerdrHub).State'
}

deploy_server() {
  dir="${HERDR_HUB_DIR:-$HOME/.local/share/herdr-hub}"
  node_bin="$(dirname "$(command -v node)")"
  plist="$HOME/Library/LaunchAgents/local.herdr-hub.plist"
  mkdir -p "$dir/data"
  rsync -a --delete --exclude=node_modules --exclude=data --exclude=.git --exclude=deploy.sh --exclude=deploy.env --exclude=run.cmd ./ "$dir/"
  (cd "$dir" && PATH="$node_bin:$PATH" npm ci --silent --omit=dev >/dev/null)
  sed "s#__DIR__#$dir#g" mac/local.herdr-hub.plist > "$plist"
  launchctl bootout "gui/$(id -u)/local.herdr-hub" 2>/dev/null || true
  # bootout returns before the job is gone; bootstrapping too early fails with EIO.
  for _ in 1 2 3 4 5 6 7 8 9 10; do launchctl print "gui/$(id -u)/local.herdr-hub" >/dev/null 2>&1 || break; sleep 0.5; done
  launchctl bootstrap "gui/$(id -u)" "$plist"
  sleep 2
  launchctl print "gui/$(id -u)/local.herdr-hub" | grep -E '^\s+(state|pid) ='
  # HTTPS 8443 on this node -> Herdr Hub. 443 is left alone: it already serves something else.
  if [ -n "$SERVER_SERVE" ]; then
    tailscale serve status --json | grep -q "\"$SERVER_SERVE\"" || tailscale serve --bg --https=8443 http://127.0.0.1:8787
  fi
}
# The MacBook Air: its own Hub for its own herdr, not a peer of the desktop hub (it travels),
# with desktop and server as its peers; when they are off or there is no network they stay as
# ghosts and its own agents work as before. ALLOW_LOCAL: http://localhost:8787 needs no Tailscale
# login, so it works with no network. Its data/host.env (written by hand, mac/run.sh) holds that;
# HERDR_HUB_PEERS there is only the seed of data/peers.json (Settings > Connection after that).
deploy_macbook() {
  need MACBOOK_SSH
  ssh -o ConnectTimeout=8 "$MACBOOK_SSH" 'mkdir -p ~/.local/share/herdr-hub/data; [ -f ~/.local/share/herdr-hub/data/host.env ]' || { echo "$MACBOOK_SSH: write ~/.local/share/herdr-hub/data/host.env first (mac/run.sh)" >&2; exit 2; }
  rsync -a --delete --exclude=node_modules --exclude=data --exclude=.git --exclude=deploy.sh --exclude=deploy.env --exclude=run.cmd ./ "$MACBOOK_SSH:.local/share/herdr-hub/"
  ssh "$MACBOOK_SSH" 'set -e
    dir="$HOME/.local/share/herdr-hub"
    cd "$dir"
    PATH="/opt/homebrew/bin:$PATH" npm ci --silent --omit=dev >/dev/null
    plist="$HOME/Library/LaunchAgents/local.herdr-hub.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    sed "s#__DIR__#$dir#g" mac/local.herdr-hub.plist > "$plist"
    launchctl bootout "gui/$(id -u)/local.herdr-hub" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do launchctl print "gui/$(id -u)/local.herdr-hub" >/dev/null 2>&1 || break; sleep 0.5; done
    launchctl bootstrap "gui/$(id -u)" "$plist"
    sleep 2
    launchctl print "gui/$(id -u)/local.herdr-hub" | grep -E "^\s+(state|pid) ="'
}

case "$target" in
  desktop) deploy_desktop ;;
  server) deploy_server ;;
  macbook) deploy_macbook ;;
  all)
    deploy_server
    deploy_desktop
    if [ -n "$MACBOOK_SSH" ] && ssh -o ConnectTimeout=5 -o BatchMode=yes "$MACBOOK_SSH" true 2>/dev/null; then deploy_macbook; else echo "macbook: not reachable, skipped"; fi
    ;;
  *) echo "usage: $0 [desktop|server|macbook|all]" >&2; exit 2 ;;
esac
