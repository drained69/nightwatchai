#!/bin/sh
# NIGHTWATCH AI container entrypoint.
# Cloud volume mounts (Railway, etc.) are owned by root, while the app runs as
# the unprivileged `nightwatch` user. Start as root, fix ownership of /data,
# then drop privileges before exec'ing the server.
set -e

mkdir -p /data
chown -R nightwatch:nightwatch /data 2>/dev/null || true

exec su-exec nightwatch:nightwatch "$@"
