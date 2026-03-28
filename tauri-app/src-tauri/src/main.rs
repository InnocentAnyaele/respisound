#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

/// Save an HTML report to the user's Downloads folder (or home dir as fallback).
/// Returns the full path of the saved file so the frontend can show it.
#[tauri::command]
fn save_report(
    app: tauri::AppHandle,
    content: String,
    filename: String,
) -> Result<String, String> {
    // Resolve destination directory: Downloads → home dir fallback
    let base_dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?;

    // Strip any path-separator characters from the filename for safety
    let safe_name: String = filename
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();

    let path = base_dir.join(&safe_name);
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// Fixed port — baked into the frontend static build (NEXT_PUBLIC_API_URL).
// Using a fixed port removes the need for dynamic port injection via
// sessionStorage / window.eval(), which is unreliable in WebView2 on Windows.
const BACKEND_PORT: u16 = 17531;

struct ApiProcess(Mutex<Option<Child>>);

fn get_sidecar_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let resource_dir = app
        .path()
        .resource_dir()
        .expect("failed to get resource dir");

    #[cfg(target_os = "windows")]
    {
        resource_dir
            .join("sidecar")
            .join("respisound-api")
            .join("respisound-api.exe")
    }

    #[cfg(not(target_os = "windows"))]
    {
        resource_dir
            .join("sidecar")
            .join("respisound-api")
            .join("respisound-api")
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ApiProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let sidecar_path = get_sidecar_path(&handle);

            let child = Command::new(&sidecar_path)
                .env("RESPISOUND_PORT", BACKEND_PORT.to_string())
                // Redirect stdio to null — the backend writes to its own log
                // file (%LOCALAPPDATA%\respisound\backend.log) instead.
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("failed to launch respisound-api sidecar");

            *app.state::<ApiProcess>().0.lock().unwrap() = Some(child);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_report])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                if let Some(mut child) = app.state::<ApiProcess>().0.lock().unwrap().take() {
                    child.kill().ok();
                }
            }
        });
}
