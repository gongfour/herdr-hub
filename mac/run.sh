#!/bin/sh
# Started by the LaunchAgent local.herdr-hub (see mac/local.herdr-hub.plist). launchd sends
# stdout/stderr to data/herdr-hub.log. The values below are server's (a peer of the desktop hub:
# no notifications here). Another Mac sets its own in data/host.env (shell assignments, kept
# across deploys: data/ is never copied over), e.g. the macbook, its own hub with desktop and server
# as peers, opened at http://localhost:8787 without Tailscale (./deploy.sh macbook writes it).
cd "$(dirname "$0")/.." || exit 1
mkdir -p data
# set -a: every name there reaches node, not only the ones exported again below (HERDR_HUB_PEERS).
if [ -f data/host.env ]; then set -a; . ./data/host.env; set +a; fi
export HERDR_HUB_ALLOWED_LOGINS="${HERDR_HUB_ALLOWED_LOGINS-kangwonjin.dev@gmail.com}"
export HERDR_HUB_HOST_ID="${HERDR_HUB_HOST_ID-server}"
export HERDR_HUB_HOST_LABEL="${HERDR_HUB_HOST_LABEL-server}"
# The name this peer answers to (Host header via tailscale serve on 8443); anything else gets 403.
export HERDR_HUB_HOSTS="${HERDR_HUB_HOSTS-server.uaru-monster.ts.net:8443}"
export HERDR_HUB_PUSH="${HERDR_HUB_PUSH-0}"
# 1: also answer http://localhost:8787 and 127.0.0.1 without a Tailscale login (loopback only).
export HERDR_HUB_ALLOW_LOCAL="${HERDR_HUB_ALLOW_LOCAL-}"
# Pool threads for filesystem calls that may hang (lib/fsq.js). A frozen node is killed by its
# watchdog (lib/watchdog.js); launchd's KeepAlive starts it again.
export UV_THREADPOOL_SIZE=16
# launchd starts jobs without the login shell's PATH; point at node directly.
NODE="${HERDR_HUB_NODE:-$HOME/.local/share/mise/installs/node/22.22.0/bin/node}"
exec "$NODE" server.js
