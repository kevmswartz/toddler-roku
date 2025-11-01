mod bridges;
mod error;

use bridges::{govee::GoveeSender, roku::RokuHttpClient};
use tauri::Manager;

#[tauri::command]
async fn roku_get(
    state: tauri::State<'_, RokuHttpClient>,
    url: String,
) -> Result<String, String> {
    state.get(&url).await.map_err(|err| err.to_string())
}

#[tauri::command]
async fn roku_post(
    state: tauri::State<'_, RokuHttpClient>,
    url: String,
    body: Option<String>,
) -> Result<(), String> {
    state
        .post(&url, body.as_deref())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn roku_discover(timeout_secs: Option<u64>) -> Result<Vec<bridges::roku::RokuDevice>, String> {
    bridges::roku::discover_roku_devices(timeout_secs)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn govee_send(
    state: tauri::State<'_, GoveeSender>,
    host: String,
    port: Option<u16>,
    body: serde_json::Value,
) -> Result<(), String> {
    state
        .send(&host, port, &body)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn govee_discover(timeout_ms: Option<u64>) -> Result<Vec<serde_json::Value>, String> {
    bridges::govee::discover(timeout_ms)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn govee_status(host: String, port: Option<u16>) -> Result<bridges::govee::GoveeStatus, String> {
    bridges::govee::get_status(&host, port)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn roomsense_scan(timeout_ms: Option<u64>) -> Result<Vec<serde_json::Value>, String> {
    bridges::roomsense::scan(timeout_ms)
        .await
        .map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(RokuHttpClient::default());
            app.manage(GoveeSender::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            roku_get,
            roku_post,
            roku_discover,
            govee_send,
            govee_discover,
            govee_status,
            roomsense_scan
        ])
        .run(tauri::generate_context!())
        .expect("error while running Roku Control");
}
