mod bridges;
mod error;

use bridges::roku::RokuHttpClient;
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
async fn roomsense_scan(timeout_ms: Option<u64>) -> Result<Vec<serde_json::Value>, String> {
    bridges::roomsense::scan(timeout_ms)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn is_wifi_connected() -> Result<bool, String> {
    bridges::network::is_connected_to_wifi()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_blec::init())
        .setup(|app| {
            app.manage(RokuHttpClient::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            roku_get,
            roku_post,
            roku_discover,
            roomsense_scan,
            is_wifi_connected
        ])
        .run(tauri::generate_context!())
        .expect("error while running Roku Control");
}
