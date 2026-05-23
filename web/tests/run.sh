#!/usr/bin/env bash
# Run all node:test files for pure-domain code.
# Requires Node 18+ (built-in test runner). No npm install needed.
set -e
cd "$(dirname "$0")/.."
exec node --test tests/*.test.js
