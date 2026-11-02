#!/bin/sh
# Started by the LaunchAgent local.paddock (see mac/local.paddock.plist). launchd sends
# stdout/stderr to data/paddock.log. A peer of the desktop hub: no notifications here.
cd "$(dirname "$0")/.." || exit 1
mkdir -p data
export PADDOCK_ALLOWED_LOGINS=kangwonjin.dev@gmail.com
export PADDOCK_HOST_ID=server
export PADDOCK_HOST_LABEL=server
export PADDOCK_PUSH=0
# launchd starts jobs without the login shell's PATH; point at node directly.
NODE="${PADDOCK_NODE:-$HOME/.local/share/mise/installs/node/22.22.0/bin/node}"
exec "$NODE" server.js
