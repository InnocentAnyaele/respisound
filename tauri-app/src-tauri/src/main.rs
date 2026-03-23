#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::process::{Child, Command};
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
        if let Ok(resp) = ureq::get(&url).timeout(Duration::from_secs(2)).call() {
            if resp.status() == 200 {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(500));
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
            let child = Command::new(&sidecar_path)
                .env("RESPISOUND_PORT", port.to_string())
                .spawn()
                .expect("failed to launch respisound-api sidecar");

            *app.state::<ApiProcess>().0.lock().unwrap() = Some(child);

            std::thread::spawn(move || {
                let ready = wait_for_api(port, 30);
                if ready {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.eval(&format!(
                            "sessionStorage.setItem('__RESPISOUND_API_URL__','http://127.0.0.1:{}'); window.location.reload();",
                            port
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
