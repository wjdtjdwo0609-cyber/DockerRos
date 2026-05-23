#!/usr/bin/env bash
# Launches the OPC UA ↔ WebSocket adapter that lets the web sim talk to the
# smart-factory PLC bridge. Uses the existing plc_bridge venv so asyncua
# and websockets are already available.
set -e
cd "$(dirname "$0")"

# Pinned to Python 3.12 because asyncua 1.1.8 doesn't handle PEP 749's
# lazy annotations (default in 3.14). The bridge's own venv is 3.14 which
# is fine for it as a *server* but crashes as a *client*.
VENV="$(dirname "$0")/web/opcua_venv"
if [ ! -x "$VENV/bin/python3" ]; then
  PY312="$(command -v python3.12 || echo /opt/homebrew/bin/python3.12)"
  if [ ! -x "$PY312" ]; then
    echo "❌ python3.12 을 찾을 수 없어요. 'brew install python@3.12' 후 다시 실행해주세요."
    read -n 1 -s -r -p "Press any key to close..."
    exit 1
  fi
  echo "첫 실행: Python 3.12 venv 준비 중…"
  "$PY312" -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet asyncua websockets
fi

echo "▶ OPC UA ↔ WS 어댑터 시작"
echo "  OPC UA  : opc.tcp://127.0.0.1:4840/smartfactory/server/"
echo "  WebSock : ws://127.0.0.1:9091"
echo "  Ctrl+C 종료"
echo ""
exec "$VENV/bin/python3" "$(dirname "$0")/web/opcua_ws_adapter.py"
