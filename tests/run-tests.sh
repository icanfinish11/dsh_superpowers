#!/usr/bin/env bash
set -euo pipefail

# Tests for the dsh_superpowers adapter. The plugin is dependency-free, so the
# suite needs only Node 18+ and runs the module against a faked dsh context —
# no harness install required. Install first (`npm install` / `pnpm install`) to
# also exercise the real `superpowers` dependency skills.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
    echo "run-tests.sh: node is required to run the dsh_superpowers tests" >&2
    exit 1
fi

node "$SCRIPT_DIR/test-plugin.mjs"
