#!/usr/bin/env bash
set -euo pipefail

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "xvfb-run is missing. Run scripts/setup-linux-electron-deps.sh first." >&2
  exit 1
fi
if ! command -v dbus-run-session >/dev/null 2>&1; then
  echo "dbus-run-session is missing. Run scripts/setup-linux-electron-deps.sh first." >&2
  exit 1
fi
if ! command -v gnome-keyring-daemon >/dev/null 2>&1; then
  echo "gnome-keyring-daemon is missing. Run scripts/setup-linux-electron-deps.sh first." >&2
  exit 1
fi

SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-20}"

set +e
# shellcheck disable=SC2016
timeout "${SMOKE_TIMEOUT_SECONDS}"s dbus-run-session -- sh -c '
  KEY="$(gnome-keyring-daemon --start --components=secrets)"
  export "$KEY"
  xvfb-run -a env ELECTRON_DISABLE_SANDBOX=1 npm start
'
status=$?
set -e

if [ "$status" -eq 124 ]; then
  echo "Smoke run reached timeout (${SMOKE_TIMEOUT_SECONDS}s): startup path looks healthy."
  exit 0
fi

exit "$status"
