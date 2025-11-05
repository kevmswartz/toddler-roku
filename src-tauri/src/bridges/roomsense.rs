use crate::error::{BridgeError, BridgeResult};
use serde_json::{json, Value};

/// Scan for nearby BLE devices and return their RSSI values
///
/// Note: This is now a simple wrapper that delegates to tauri-plugin-blec.
/// The actual scanning is handled by the plugin's commands which are called
/// directly from the frontend for better cross-platform support (especially Android).
///
/// This function is kept for backward compatibility with existing frontend code.
pub async fn scan(_timeout_ms: Option<u64>) -> BridgeResult<Vec<Value>> {
    // The actual BLE scanning is now handled by tauri-plugin-blec
    // which provides proper Android support through native APIs.
    //
    // Frontend should use: import { startScan } from '@mnlphlp/plugin-blec'
    //
    // This wrapper is kept for compatibility but returns a message
    // instructing to use the plugin directly.

    println!("⚠️  roomsense_scan called - please use tauri-plugin-blec directly from frontend");

    Ok(vec![
        json!({
            "note": "BLE scanning now uses tauri-plugin-blec. Please call startScan() from the frontend.",
            "migration": "import { startScan } from '@mnlphlp/plugin-blec'; await startScan((devices) => { ... }, 5000);",
            "type": "info"
        })
    ])
}
