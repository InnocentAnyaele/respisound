# RespiSound — Desktop Clinical Screening Platform

A respiratory disease screening tool that analyses cough audio samples and classifies them into five categories: Asthma, Bronchitis, COPD, Healthy, and Pneumonia. Built as a standalone desktop application for clinical use in low-resource settings where internet access cannot be guaranteed.

---

## Table of Contents

- [How It Works](#how-it-works)
- [End User Installation](#end-user-installation)
- [Development Setup — Windows](#development-setup--windows)
- [Development Setup — Ubuntu](#development-setup--ubuntu)
- [Building the Desktop App — Windows](#building-the-desktop-app--windows)
- [Building the Desktop App — Ubuntu](#building-the-desktop-app--ubuntu)
- [Plugging In the Trained Model](#plugging-in-the-trained-model)
- [Demo Mode](#demo-mode)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Clinical Disclaimer](#clinical-disclaimer)

---

## How It Works

At runtime, the Tauri desktop shell launches a bundled Python executable (`respisound-api`, built with PyInstaller) as a background process on port **17531**. The Next.js UI is embedded in the app as a static export and loaded by the Tauri webview. The UI talks to `http://127.0.0.1:17531`. When the window closes, Rust kills the background process cleanly.

Data is stored locally on the device — no internet connection required:

| Platform | Data Location |
|----------|---------------|
| Windows  | `%LOCALAPPDATA%\respisound\` |
| Linux    | `~/.local/share/respisound/` |

This folder contains `respisound.db` (SQLite database) and an `uploads/` subfolder for audio files.

---

## End User Installation

Download the latest installer from the [Releases](../../releases) page. No Python, Node.js, or Rust required.

| Platform | File to download |
|----------|-----------------|
| Windows  | `respisound_x64-setup.exe` (recommended) or `respisound_x64.msi` |
| Ubuntu / Debian | `respisound_amd64.deb` or `respisound_amd64.AppImage` |

**Windows note:** Windows may show a SmartScreen warning on first launch because the installer is not code-signed. Click **"More info" → "Run anyway"** to proceed.

**AppImage note (Linux):** make the file executable before running:
```bash
chmod +x respisound_*.AppImage
./respisound_*.AppImage
```

---

## Development Setup — Windows

In development mode the backend and frontend run as separate processes. You do **not** need Rust or Tauri — just Python and Node.js. Open `http://localhost:3000` in your browser.

### 1. Install Git

Download from [git-scm.com](https://git-scm.com/download/win) and install with default options.

### 2. Install Python 3.12

Download the installer from [python.org](https://www.python.org/downloads/).

> During installation, tick **"Add Python to PATH"** on the first screen before clicking Install.

Verify in a new Command Prompt:
```cmd
python --version
pip --version
```

### 3. Install Node.js 20

Download the LTS installer from [nodejs.org](https://nodejs.org/).

Verify:
```cmd
node --version
npm --version
```

### 4. Clone the Repository

```cmd
git clone <repo-url>
cd respisound-platform
```

### 5. Install Backend Dependencies (one-time)

PyTorch must be installed separately first using the CPU-only index. Skipping this step and running `pip install -r requirements.txt` directly would download the full CUDA build (~2.5 GB instead of ~500 MB).

```cmd
cd backend
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

### 6. Install Frontend Dependencies (one-time)

```cmd
cd frontend
npm install
```

### 7. Run

Open **two separate Command Prompt windows**.

**Terminal 1 — Backend:**
```cmd
cd backend
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — Frontend:**
```cmd
cd frontend
set NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
npm run dev
```

Open `http://localhost:3000` in your browser.

---

## Development Setup — Ubuntu

Tested on Ubuntu 22.04 and 24.04.

### 1. Install Git

```bash
sudo apt update
sudo apt install git
```

### 2. Install Python 3.12

**Ubuntu 24.04 (Noble)** — Python 3.12 is in the default repos:
```bash
sudo apt update
sudo apt install python3.12 python3.12-venv python3-pip
```

**Ubuntu 22.04 (Jammy)** — add the deadsnakes PPA:
```bash
sudo apt update
sudo apt install software-properties-common
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update
sudo apt install python3.12 python3.12-venv python3.12-distutils
curl -sS https://bootstrap.pypa.io/get-pip.py | python3.12
```

Verify:
```bash
python3.12 --version
pip3 --version
```

### 3. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs
```

Verify:
```bash
node --version
npm --version
```

### 4. Clone the Repository

```bash
git clone <repo-url>
cd respisound-platform
```

### 5. Install Backend Dependencies (one-time)

```bash
cd backend
pip3 install torch --index-url https://download.pytorch.org/whl/cpu
pip3 install -r requirements.txt
```

### 6. Install Frontend Dependencies (one-time)

```bash
cd frontend
npm install
```

### 7. Run

The dev script starts both processes at once:

```bash
chmod +x scripts/dev.sh
./scripts/dev.sh
```

Or manually in two separate terminals:

**Terminal 1 — Backend:**
```bash
cd backend
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — Frontend:**
```bash
cd frontend
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 npm run dev
```

Open `http://localhost:3000` in your browser.

---

## Building the Desktop App — Windows

This produces a `.exe` installer and `.msi` that end users can install directly.

### 1. Complete the Development Setup

Follow all steps in [Development Setup — Windows](#development-setup--windows) first.

### 2. Install Rust

Download and run `rustup-init.exe` from [rustup.rs](https://rustup.rs/). Accept the default installation options.

Restart your Command Prompt after installation, then verify:
```cmd
rustc --version
cargo --version
```

> If you use Conda, note that Conda environments do not include Rust. Install via rustup regardless.

### 3. Install WebView2 (if not already present)

WebView2 is pre-installed on Windows 10 (version 1803+) and Windows 11. If it is missing, download the Evergreen Runtime from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

### 4. Build the Python Backend

This compiles the FastAPI server into a standalone `.exe` using PyInstaller:

```cmd
scripts\build_backend.bat
```

This places the output in `tauri-app\src-tauri\sidecar\respisound-api\`.

### 5. Build the Tauri App

```cmd
cd tauri-app
npm install
npm run tauri:build
```

The installer is output to:
```
tauri-app\src-tauri\target\release\bundle\nsis\respisound_x64-setup.exe
tauri-app\src-tauri\target\release\bundle\msi\respisound_x64.msi
```

### Automated Builds via GitHub Actions

Pushing a `v*` tag triggers the CI workflow which builds and publishes a GitHub Release automatically:

```cmd
git tag v1.0.1
git push origin v1.0.1
```

---

## Building the Desktop App — Ubuntu

This produces a `.deb` package and `.AppImage`.

### 1. Complete the Development Setup

Follow all steps in [Development Setup — Ubuntu](#development-setup--ubuntu) first.

### 2. Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Accept the default options. Then load Rust into your current shell:

```bash
source "$HOME/.cargo/env"
```

Verify:
```bash
rustc --version
cargo --version
```

Add this line to your `~/.bashrc` so Rust is available in future terminals:
```bash
echo 'source "$HOME/.cargo/env"' >> ~/.bashrc
```

### 3. Install Tauri System Libraries

These are the GTK and WebKit libraries Tauri needs to compile and run on Linux.

**Ubuntu 24.04 (Noble):**
```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libxdo-dev \
  build-essential \
  pkg-config \
  curl \
  wget \
  file
```

**Ubuntu 22.04 (Jammy):**
```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.0-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libxdo-dev \
  build-essential \
  pkg-config \
  curl \
  wget \
  file
```

> The package name changes between Ubuntu versions: `libwebkit2gtk-4.1-dev` on Noble, `libwebkit2gtk-4.0-dev` on Jammy. Using the wrong one will cause a build failure.

### 4. Build the Python Backend

```bash
chmod +x scripts/build_backend.sh
./scripts/build_backend.sh
```

This runs PyInstaller and copies the output to `tauri-app/src-tauri/sidecar/respisound-api/`.

### 5. Build the Tauri App

```bash
cd tauri-app
npm install
npm run tauri:build
```

Output is in:
```
tauri-app/src-tauri/target/release/bundle/deb/respisound_amd64.deb
tauri-app/src-tauri/target/release/bundle/appimage/respisound_amd64.AppImage
```

Install the `.deb`:
```bash
sudo dpkg -i tauri-app/src-tauri/target/release/bundle/deb/respisound_amd64.deb
```

### Automated Builds via GitHub Actions

```bash
git tag v1.0.1
git push origin v1.0.1
```

The CI workflow builds both Windows and Linux releases and publishes them to GitHub Releases automatically.

---

## Plugging In the Trained Model

The model file is not included in the repository. Without it, the app runs in Demo Mode (see below).

Save your trained PyTorch checkpoint in the following format:

```python
torch.save({
    "model_state_dict": model.state_dict(),
}, "backend/model/respisound_model.pt")
```

Place the file at `backend/model/respisound_model.pt`. The API loads it automatically on startup and the `/health` endpoint will return `"model_loaded": true`.

If you rebuild the desktop app after adding the model, PyInstaller will bundle it inside the installer so end users get live inference out of the box.

---

## Demo Mode

When `backend/model/respisound_model.pt` is not found, the app runs in Demo Mode automatically. In this mode:

- All API endpoints work normally
- The `/screen` endpoint returns plausible random predictions (Dirichlet distribution seeded on the audio filename, so the same file always produces the same result)
- Patient records, history, and the database all work as normal
- Results are tagged with a **Demo** badge in the UI

No configuration is needed to enable or disable Demo Mode — it is determined entirely by whether the model file is present at startup.

---

## API Reference

All endpoints are served at `http://127.0.0.1:8000` in development and `http://127.0.0.1:17531` in the packaged desktop app.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server status and `model_loaded` flag |
| GET | `/stats` | Total screenings, patients, class distribution |
| POST | `/patients` | Register a new patient |
| GET | `/patients` | List all patients |
| GET | `/patients/:id` | Get a single patient |
| POST | `/screen` | Upload audio and run inference |
| GET | `/screenings` | List screenings (optional `?patient_id=`) |
| GET | `/screenings/:id` | Get a single screening |
| GET | `/explain/:id` | Mel spectrogram, GradCAM, acoustic features |

The `/screen` endpoint accepts `multipart/form-data`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `audio` | file | Yes | Audio file — WAV recommended, 16 kHz mono preferred |
| `patient_id` | string | No | UUID of a registered patient |
| `notes` | string | No | Clinical notes to attach to the screening |

---

## Project Structure

```
respisound-platform/
├── backend/
│   ├── main.py               FastAPI app — REST endpoints, inference pipeline, SQLite
│   ├── model_definition.py   CRNN model architecture
│   ├── requirements.txt
│   └── respisound.spec       PyInstaller bundle configuration
│
├── frontend/
│   ├── pages/
│   │   ├── index.tsx         Dashboard with charts
│   │   ├── screen.tsx        Audio upload and results
│   │   ├── patients.tsx      Patient registry
│   │   └── history.tsx       Screening history
│   ├── components/
│   │   └── Layout.tsx        Sidebar navigation
│   ├── lib/
│   │   └── api.ts            Typed API client
│   └── styles/globals.css
│
├── tauri-app/
│   ├── src-tauri/
│   │   ├── src/main.rs       Spawns backend sidecar, manages lifecycle
│   │   ├── tauri.conf.json   Window config, CSP, bundle settings
│   │   └── Cargo.toml
│   └── package.json
│
├── scripts/
│   ├── dev.sh                Dev launcher (Linux/macOS)
│   ├── build_backend.sh      PyInstaller build + stage (Linux/macOS)
│   └── build_backend.bat     PyInstaller build + stage (Windows)
│
└── .github/
    └── workflows/
        └── build.yml         CI — builds Windows + Linux, publishes on v* tags
```

---

## Clinical Disclaimer

RespiSound is a decision support tool. Results must be interpreted by qualified clinical personnel alongside physical examination, patient history, and established diagnostic procedures. It is not a replacement for spirometry, chest X-ray, or physician assessment.
