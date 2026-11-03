#!/bin/sh
# Started by the LaunchAgent local.herdr-hub (see mac/local.herdr-hub.plist). launchd sends
# stdout/stderr to data/herdr-hub.log. A peer of the desktop hub: no notifications here.
cd "$(dirname "$0")/.." || exit 1
mkdir -p data
export HERDR_HUB_ALLOWED_LOGINS=kangwonjin.dev@gmail.com
export HERDR_HUB_HOST_ID=server
export HERDR_HUB_HOST_LABEL=server
# The name this peer answers to (Host header via tailscale serve on 8443); anything else gets 403.
export HERDR_HUB_HOSTS=server.uaru-monster.ts.net:8443
export HERDR_HUB_PUSH=0
# launchd starts jobs without the login shell's PATH; point at node directly.
NODE="${HERDR_HUB_NODE:-$HOME/.local/share/mise/installs/node/22.22.0/bin/node}"
exec "$NODE" server.js
