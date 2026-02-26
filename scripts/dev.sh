#!/bin/bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
    echo ""
    echo "Shutting down..."
    kill "$BACKEND_PID" 2>/dev/null
    kill "$FRONTEND_PID" 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

echo "Starting RespiSound in development mode..."
echo ""

cd "$ROOT/backend"
uvicorn main:app --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!

sleep 2

cd "$ROOT/frontend"
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 npm run dev &
FRONTEND_PID=$!

echo ""
echo "Backend:  http://127.0.0.1:8000"
echo "Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop."

wait
