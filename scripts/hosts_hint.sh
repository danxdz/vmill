#!/usr/bin/env bash
set -euo pipefail
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -z "${IP}" ]]; then
  IP="127.0.0.1"
fi

cat <<TXT
Detected host IP: ${IP}

Optional /etc/hosts entries for client machines:
  ${IP} vmill.local
  ${IP} vmill-ocr.local

Then use:
  http://vmill.local:8080/login.html
  http://vmill-ocr.local:8081/docs
TXT
