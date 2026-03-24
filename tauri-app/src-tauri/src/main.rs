#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent};

struct ApiProcess(Mutex<Option<Child>>);

fn find_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("failed to bind random port");
    listener.local_addr().unwrap().port()
}

fn get_sidecar_path(app: &AppHandle) -> std::path::PathBuf {
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

fn wait_for_api(port: u16, max_tries: u32) -> bool {
    use std::time::Duration;
    let url = format!("http://127.0.0.1:{}/health", port);
    for _ in 0..max_tries {
        if let Ok(resp) = ureq::get(&url).timeout(Duration::from_secs(3)).call() {
            if resp.status() == 200 {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(1000));
    }
    false
}

#[tauri::command]
fn get_api_port(state: tauri::State<'_, ApiPortState>) -> u16 {
    *state.0.lock().unwrap()
}

struct ApiPortState(Mutex<u16>);

fn main() {
    let port = find_free_port();

    tauri::Builder::default()
        .manage(ApiProcess(Mutex::new(None)))
        .manage(ApiPortState(Mutex::new(port)))
        .setup(move |app| {
            let handle = app.handle().clone();
            let sidecar_path = get_sidecar_path(&handle);

            // Write a Tauri-side debug log so startup failures are diagnosable.
            let log_dir = {
                #[cfg(target_os = "windows")]
                {
                    std::path::PathBuf::from(
                        std::env::var("LOCALAPPDATA")
                            .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned()),
                    )
                    .join("respisound")
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let base = std::env::var("XDG_DATA_HOME")
                        .map(std::path::PathBuf::from)
                        .unwrap_or_else(|_| {
                            std::path::PathBuf::from(
                                std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()),
                            )
                            .join(".local")
                            .join("share")
                        });
                    base.join("respisound")
                }
            };
            let _ = std::fs::create_dir_all(&log_dir);
            let tauri_log_path = log_dir.join("tauri.log");
            if let Ok(mut f) = OpenOptions::new().create(true).write(true).truncate(true).open(&tauri_log_path) {
                let _ = writeln!(f, "sidecar_path: {:?}", sidecar_path);
                let _ = writeln!(f, "sidecar_exists: {}", sidecar_path.exists());
                let _ = writeln!(f, "port: {}", port);
            }

            let child = Command::new(&sidecar_path)
                .env("RESPISOUND_PORT", port.to_string())
                // Prevent the child from inheriting the parent's (null) stdio
                // handles — critical for windowed apps on Windows.
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("failed to launch respisound-api sidecar");

            *app.state::<ApiProcess>().0.lock().unwrap() = Some(child);

            let log_dir_thread = log_dir.clone();
            std::thread::spawn(move || {
                // Allow up to 120 s for the sidecar to start.
                // PyTorch + librosa initialisation can take 30-60 s on first
                // launch while the OS loads and verifies the bundled DLLs.
                let ready = wait_for_api(port, 120);
                if let Some(window) = handle.get_webview_window("main") {
                    if ready {
                        let _ = window.eval(&format!(
                            "sessionStorage.setItem('__RESPISOUND_API_URL__','http://127.0.0.1:{}'); window.location.reload();",
                            port
                        ));
                    } else {
                        // Pass log paths so the UI can tell the user where to look.
                        let log_hint = log_dir_thread.to_string_lossy().replace('\\', "\\\\");
                        let _ = window.eval(&format!(
                            "document.dispatchEvent(new CustomEvent('respisound:api-failed',{{detail:'{}' }}));",
                            log_hint
                        ));
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_api_port])
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
