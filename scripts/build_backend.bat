@echo off
setlocal

set SCRIPT_DIR=%~dp0
set ROOT=%SCRIPT_DIR%..

echo === RespiSound Build Script ===
echo.

echo [1/4] Installing Python backend dependencies...
cd %ROOT%\backend
pip install -r requirements.txt --quiet
if errorlevel 1 goto error

echo [2/4] Building FastAPI backend with PyInstaller...
pyinstaller respisound.spec --clean --noconfirm
if errorlevel 1 goto error

echo [3/4] Staging sidecar for Tauri...
set SIDECAR_DIR=%ROOT%\tauri-app\src-tauri\sidecar\respisound-api
if not exist "%SIDECAR_DIR%" mkdir "%SIDECAR_DIR%"
xcopy /E /Y dist\respisound-api\* "%SIDECAR_DIR%\"

echo [4/4] Installing frontend dependencies...
cd %ROOT%\frontend
call npm install --silent
if errorlevel 1 goto error

echo.
echo === Backend build complete ===
echo Run: cd tauri-app ^&^& npm run tauri build
goto end

:error
echo.
echo Build failed. Check errors above.
exit /b 1

:end
