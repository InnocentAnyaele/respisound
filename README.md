# RespiSound — Desktop Clinical Screening Platform

A respiratory disease screening tool that analyses cough audio samples and classifies them into five categories: Asthma, Bronchitis, COPD, Healthy, and Pneumonia (model output order). Built as a standalone desktop application for clinical use in low-resource settings where internet access cannot be guaranteed.

---

## Architecture

```
respisound/
├── backend/                  FastAPI inference server
│   ├── main.py               REST API, SQLite persistence, inference pipeline
│   ├── model_definition.py   CRNN architecture definition
│   ├── requirements.txt
│   └── respisound.spec       PyInstaller bundle spec
│
├── frontend/                 Next.js static web UI
│   ├── pages/
│   │   ├── index.tsx         Clinical dashboard with charts
│   │   ├── screen.tsx        Audio upload + real-time results
│   │   ├── patients.tsx      Patient registry
│   │   └── history.tsx       Filterable screening history
│   ├── components/
│   │   └── Layout.tsx        Sidebar navigation shell
│   ├── lib/
│   │   └── api.ts            Typed API client
│   └── styles/globals.css    Design tokens and base styles
│
├── tauri-app/                Desktop wrapper
│   ├── src-tauri/
│   │   ├── src/main.rs       Spawns backend sidecar, manages lifecycle
│   │   ├── Cargo.toml
│   │   ├── build.rs
│   │   └── tauri.conf.json   Bundle config, window settings, CSP
│   └── package.json
│
└── scripts/
    ├── dev.sh                Development runner (Unix)
    ├── build_backend.sh      Build + stage sidecar (Unix)
    └── build_backend.bat     Build + stage sidecar (Windows)
```

### How the pieces connect

At runtime, Tauri launches the bundled `respisound-api` executable (the PyInstaller output) as a child process on a randomly assigned local port. The Next.js static build is served directly by Tauri's built-in webview. The frontend's `api.ts` targets `http://127.0.0.1:<port>`, which the Rust core injects into the window via `window.__RESPISOUND_API_URL__`. When the app window closes, Rust kills the child process cleanly.

Data is persisted locally in `respisound.db` (SQLite), stored alongside the executable. Uploaded audio files are retained in an `uploads/` folder in the same directory.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.10+ | Backend + PyInstaller |
| Node.js | 18+ | Frontend build |
| Rust | 1.70+ | Tauri compilation |
| Tauri CLI | **2.x** | Desktop bundling (v2 required for **Ubuntu 24.04** — v1 needs WebKit/JavaScriptCore **4.0**, which Noble no longer ships) |
| **Rust (cargo)** | **1.70+** | **Required for `npm run tauri:build`** — if you see `failed to get cargo metadata: No such file or directory`, install Rust and put `cargo` on your `PATH` |

Install Rust (required before Tauri build):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Then reload your shell, or:
source "$HOME/.cargo/env"
cargo --version
```

On **Linux**, install [Tauri **v2** system dependencies](https://v2.tauri.app/start/prerequisites/#linux). This project uses **Tauri 2** so it builds on **Ubuntu 24.04** (WebKitGTK **4.1** / JavaScriptCore **4.1**). Older **Tauri 1** on Noble often fails with *`javascriptcoregtk-4.0` was not found* because that `.pc` file is not in Ubuntu’s archives anymore.

**Ubuntu 24.04 (Noble)** — WebKit **4.1**:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  build-essential pkg-config curl wget file libssl-dev libxdo-dev
```

**Ubuntu 22.04 (Jammy)** — WebKit **4.0** (use this package name on Jammy):

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.0-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  build-essential pkg-config curl wget file libssl-dev libxdo-dev
```

If `sudo apt update` fails because of **broken extra repos** (404 / “Payment Required” / unsigned), fix or remove those entries under `/etc/apt/sources.list.d/`, then run `sudo apt update` again.

Optional global CLI (the repo also uses the local CLI from `tauri-app/node_modules`):

```bash
npm install -g @tauri-apps/cli@^2
```

Install Rust: https://rustup.rs

---

## Development (without Tauri)

The fastest way to run the project during development is to start the backend and frontend separately.

```bash
chmod +x scripts/dev.sh
./scripts/dev.sh
```

This starts the FastAPI server on port 8000 and the Next.js dev server on port 3000. Open `http://localhost:3000` in a browser.

On Windows, start both manually in separate terminals:

```powershell
# Terminal 1
cd backend
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2
cd frontend
set NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
npm run dev
```

---

## Plugging in the trained model

Once training is complete, save the PyTorch checkpoint like this:

```python
torch.save({
    "model_state_dict": model.state_dict(),
    "classes": ["Asthma", "COPD", "Pneumonia", "Bronchitis", "Healthy"]
}, "backend/model/respisound_model.pt")
```

If the final architecture differs from the placeholder in `model_definition.py`, update that file to match. The `RespiSoundCRNN` class signature needs to stay consistent — specifically the `num_classes` parameter.

The API detects the model file on startup and exits demo mode automatically. The `/health` endpoint reports `model_loaded: true` once the model is active.

---

## Production build (desktop .exe / .dmg / .AppImage)

### Step 1 — Build and stage the Python backend

Unix:
```bash
chmod +x scripts/build_backend.sh
./scripts/build_backend.sh
```

Windows:
```bat
scripts\build_backend.bat
```

This runs PyInstaller and copies the output into `tauri-app/src-tauri/sidecar/respisound-api/`.

### Step 2 — Build the Tauri desktop app

Ensure `cargo` works in the same terminal (`cargo --version`, or `./scripts/check_rust.sh`). Conda does not include Rust; use `rustup` as above.

```bash
cd tauri-app
npm install
npm run tauri:build
```

`beforeBuildCommand` runs `npm run build` here, which installs frontend deps if needed and runs **`next build`** in `../frontend` (static export → `frontend/out`). In `tauri.conf.json`, **`distDir` is relative to `src-tauri/`**, so it must be `../../frontend/out` (not `../frontend/out`), or Tauri will report missing web assets.

### What one installer contains

You get **one** desktop artifact (e.g. `.AppImage` or `.deb`) that runs **both**:

1. **Frontend** — the Next.js **static export** (`frontend/out`) is **embedded** in the app; the Tauri window is a webview that loads that UI (no separate `npm run dev` for end users).
2. **Backend** — the PyInstaller **`respisound-api`** binary is bundled under `sidecar/` (see `bundle.resources` in `tauri.conf.json`). Rust **spawns it** on startup and your UI talks to `http://127.0.0.1:<port>`.

So the “final file” is not backend-only: it is **Rust shell + baked-in static UI + Python API sidecar**.

Tauri compiles the Rust core, copies those assets, and produces installers under `tauri-app/src-tauri/target/release/bundle/`.

Output files by platform:
- **Windows** → `respisound_1.0.0_x64.msi` or `respisound_1.0.0_x64-setup.exe`
- **macOS** → `RespiSound_1.0.0_x64.dmg`
- **Linux** → `respisound_1.0.0_amd64.AppImage` and `.deb`

---

## API reference

All endpoints are served at `http://127.0.0.1:<port>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Status and model loaded flag |
| GET | `/stats` | Aggregate counts and class distribution |
| POST | `/patients` | Register a new patient |
| GET | `/patients` | List all patients |
| GET | `/patients/:id` | Get single patient |
| POST | `/screen` | Upload audio and run inference |
| GET | `/screenings` | List screenings (optional `?patient_id=`) |
| GET | `/screenings/:id` | Get single screening |

The `/screen` endpoint accepts `multipart/form-data` with:
- `audio` — audio file (WAV recommended, 16kHz mono preferred)
- `patient_id` — optional UUID from `/patients`
- `notes` — optional clinical notes string

---

## Demo mode

When no model file is found at `backend/model/respisound_model.pt`, the API runs in demo mode. Probabilities are randomly generated using a Dirichlet distribution seeded on the audio filename. All other functionality — patient records, history, database — works normally. The frontend displays a "Demo mode" badge on any result produced in this state.

---

## Deployment note

The system is designed for fully local, offline operation. All inference, data storage, and the UI are self-contained within the installed application. No data leaves the device. For multi-workstation clinic setups, the backend can run on a shared local network machine — the FastAPI server is not restricted to localhost if the `--host` flag is changed when starting the server.

---

## Clinical disclaimer

RespiSound is a decision support tool. Results must be interpreted by qualified clinical personnel alongside physical examination, patient history, and established diagnostic procedures. It is not a replacement for spirometry, chest X-ray, or physician assessment.