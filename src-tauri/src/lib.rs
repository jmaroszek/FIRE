use std::process::{Child, Command};
use std::sync::Mutex;

/// Spawn the bundled Python engine if it sits next to the app executable
/// (PyInstaller onedir layout: fire-server/fire-server.exe). In dev there is
/// no bundled engine — the sidecar is run manually (`python server/main.py`)
/// and this silently does nothing.
fn spawn_engine() -> Option<Child> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let server = exe_dir.join("fire-server").join("fire-server.exe");
    if !server.exists() {
        return None;
    }
    let mut cmd = Command::new(server);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().ok()
}

/// Kill the engine and anything it spawned (process tree, not just the pid).
fn kill_engine(child: &mut Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    let _ = child.kill();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine: Mutex<Option<Child>> = Mutex::new(spawn_engine());

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(child) = engine.lock().unwrap().as_mut() {
                    kill_engine(child);
                }
            }
        });
}
