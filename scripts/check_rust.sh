#!/usr/bin/env bash
# Tauri needs `cargo` on PATH (install via https://rustup.rs).
set -e
if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo not found. Install Rust:"
  echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  echo "  source \"\$HOME/.cargo/env\""
  echo "Then run: cargo --version"
  exit 1
fi
cargo --version
