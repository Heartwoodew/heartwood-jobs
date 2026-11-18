mod nav;

use nav::{classify, downloads_dir, place_download, Destination, LIVE_APP_URL};
use tauri::webview::DownloadEvent;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

/// The Windows program loads the live CallUp site. Business logic stays in that site.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            build_main(app.handle())?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                check_update(handle).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("CallUp failed to start");
}

fn build_main(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let url: Url = LIVE_APP_URL.parse().expect("CallUp start URL");
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("CallUp")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 640.0)
        .resizable(true)
        .center()
        .focused(true)
        .initialization_script("window.__CALLUP_DESKTOP__ = true;")
        .on_navigation(|url| match classify(url) {
            Destination::InApp => true,
            Destination::External => {
                let _ = open::that_detached(url.as_str());
                false
            }
            Destination::Ignore => false,
        })
        .on_new_window(|url, _features| match classify(&url) {
            // Allow keeps the WebView2 environment, so print previews (blob and about:blank)
            // and a Google sign-in popup can still talk to the page that opened them.
            Destination::InApp => tauri::webview::NewWindowResponse::Allow,
            Destination::External => {
                let _ = open::that_detached(url.as_str());
                tauri::webview::NewWindowResponse::Deny
            }
            Destination::Ignore => tauri::webview::NewWindowResponse::Deny,
        })
        .on_download(|_webview, event| {
            if let DownloadEvent::Requested { destination, .. } = event {
                if let Some(dir) = downloads_dir() {
                    *destination = place_download(destination, &dir);
                }
            }
            true
        });
    builder.build()
}

async fn check_update(app: tauri::AppHandle) {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            eprintln!("CallUp updater is not available: {err}");
            return;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            eprintln!("CallUp update {} is ready", update.version);
            if let Err(err) = update.download_and_install(|_, _| {}, || {}).await {
                eprintln!("CallUp update failed: {err}");
                return;
            }
            app.restart();
        }
        Ok(None) => {}
        Err(err) => eprintln!("CallUp update check skipped: {err}"),
    }
}
