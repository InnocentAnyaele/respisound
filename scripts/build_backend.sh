#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

echo "=== RespiSound Build Script ==="
echo ""

echo "[1/4] Installing Python backend dependencies..."
cd "$ROOT/backend"
pip install -r requirements.txt --quiet

echo "[2/4] Building FastAPI backend with PyInstaller..."
pyinstaller respisound.spec --clean --noconfirm

echo "[3/4] Staging sidecar for Tauri..."
SIDECAR_DIR="$ROOT/tauri-app/src-tauri/sidecar/respisound-api"
mkdir -p "$SIDECAR_DIR"
cp -r dist/respisound-api/. "$SIDECAR_DIR/"

echo "[4/4] Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install --silent

echo ""
echo "=== Backend build complete ==="
echo "Run 'npm run tauri build' inside tauri-app/ to produce the final installer."
