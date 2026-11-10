#!/bin/sh
# Herdr Hub on a Mac, started by the LaunchAgent local.herdr-hub (mac/local.herdr-hub.plist).
# launchd sends stdout/stderr to data/herdr-hub.log. This host's settings are in data/host.env:
# shell assignments, kept across deploys (data/ is never copied over) and not in git. For example
# a peer of another hub, behind `tailscale serve --https=8443`:
#   HERDR_HUB_ALLOWED_LOGINS=you@example.com
#   HERDR_HUB_HOST_ID=server
#   HERDR_HUB_HOSTS=server.example.ts.net:8443
#   HERDR_HUB_PUSH=0
# or a laptop's own hub opened at http://localhost:8787 without Tailscale, with peers:
#   HERDR_HUB_ALLOW_LOCAL=1
#   HERDR_HUB_PEERS=desktop=https://desktop.example.ts.net
# and HERDR_HUB_NODE when node is not on launchd's PATH.
cd "$(dirname "$0")/.." || exit 1
mkdir -p data
# set -a: every name there reaches node.
if [ -f data/host.env ]; then set -a; . ./data/host.env; set +a; fi
# Pool threads for filesystem calls that may hang (lib/fsq.js). A frozen node is killed by its
# watchdog (lib/watchdog.js); launchd's KeepAlive starts it again.
export UV_THREADPOOL_SIZE=16
# launchd starts jobs without the login shell's PATH; point at node directly if needed.
NODE="${HERDR_HUB_NODE:-$(command -v node || echo /opt/homebrew/bin/node)}"
exec "$NODE" server.js
