#!/bin/sh
set -eu
# Initialize the cloud-mounted private volume, then drop privileges for the service.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /var/lib/cravecart/uploads
  chown node:node /var/lib/cravecart/uploads
  chmod 700 /var/lib/cravecart/uploads
  exec gosu node "$@"
fi
exec "$@"
