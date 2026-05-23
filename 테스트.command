#!/usr/bin/env bash
cd "$(dirname "$0")"
./web/tests/run.sh
echo
echo "(창을 닫으려면 아무 키나 누르세요)"
read -n 1 -s
