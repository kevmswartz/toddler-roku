use crate::error::{BridgeError, BridgeResult};
use serde_json::{json, Value};

#[cfg(feature = "ble-scan")]
use btleplug::api::{Central, Manager as _, ScanFilter, Peripheral as _};
#[cfg(feature = "ble-scan")]
use btleplug::platform::{Manager, Peripheral};
#[cfg(feature = "ble-scan")]
use std::time::Duration;

/// Scan for nearby BLE devices and return their RSSI values
#[cfg(feature = "ble-scan")]
pub async fn scan(timeout_ms: Option<u64>) -> BridgeResult<Vec<Value>> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(5000));

    let manager = Manager::new()
        .await
        .map_err(|e| BridgeError::Network(format!("Failed to create BLE manager: {}", e)))?;

    let adapters = manager.adapters()
        .await
        .map_err(|e| BridgeError::Network(format!("Failed to get BLE adapters: {}", e)))?;

    if adapters.is_empty() {
        return Err(BridgeError::Network("No Bluetooth adapters found".into()));
    }

    // Use the first adapter
    let central = &adapters[0];

    // Start scanning
    central
        .start_scan(ScanFilter::default())
        .await
        .map_err(|e| BridgeError::Network(format!("Failed to start BLE scan: {}", e)))?;

    println!("🔍 Scanning for BLE devices for {:?}...", timeout);
    tokio::time::sleep(timeout).await;

    // Stop scanning
    central
        .stop_scan()
        .await
        .map_err(|e| BridgeError::Network(format!("Failed to stop BLE scan: {}", e)))?;

    // Get discovered peripherals
    let peripherals = central
        .peripherals()
        .await
        .map_err(|e| BridgeError::Network(format!("Failed to get peripherals: {}", e)))?;

    println!("📱 Found {} BLE devices", peripherals.len());

    let mut devices = Vec::new();

    for peripheral in peripherals {
        let properties = peripheral.properties().await.ok().flatten();

        let address = peripheral.address().to_string();

        let name = if let Some(props) = &properties {
            props.local_name.clone().or_else(|| {
                // Try to get name from services
                props.services.first().map(|s| format!("Service-{}", s))
            })
        } else {
            None
        };

        // Get RSSI (signal strength)
        let rssi = if let Some(props) = &properties {
            props.rssi
        } else {
            None
        };

        // Get manufacturer data if available
        let manufacturer_data = if let Some(props) = &properties {
            props.manufacturer_data.iter()
                .map(|(id, data)| json!({
                    "id": id,
                    "data": data.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join("")
                }))
                .collect::<Vec<_>>()
        } else {
            vec![]
        };

        let device_info = json!({
            "address": address,
            "name": name,
            "rssi": rssi,
            "manufacturer_data": manufacturer_data,
            "type": "ble"
        });

        devices.push(device_info);
    }

    println!("✅ Roomsense scan complete: {} devices with RSSI data", devices.len());
    Ok(devices)
}

/// Fallback implementation when BLE scanning is not available
#[cfg(not(feature = "ble-scan"))]
pub async fn scan(_timeout_ms: Option<u64>) -> BridgeResult<Vec<Value>> {
    // Return empty list with a note that BLE scanning is not enabled
    println!("⚠️  BLE scanning not available (feature disabled). Returning empty list.");

    // You could implement alternative proximity detection here:
    // - WiFi SSID detection
    // - Network latency-based proximity
    // - GPS-based room detection

    Ok(vec![
        json!({
            "note": "BLE scanning not available. Enable 'ble-scan' feature or use manual room selection.",
            "alternatives": ["wifi-ssid", "network-latency", "gps-geofence", "manual"],
            "type": "info"
        })
    ])
}
