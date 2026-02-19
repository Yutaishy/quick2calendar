#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports apt-based Linux only." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2t64 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2 \
  libasound2t64 \
  libxshmfence1 \
  libxss1 \
  libxtst6 \
  libsecret-1-0 \
  dbus \
  dbus-x11 \
  gnome-keyring \
  xvfb

echo "Linux Electron dependencies installed." 
