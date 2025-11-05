use std::time::Duration;
use std::net::UdpSocket;

use crate::error::{BridgeError, BridgeResult};
use serde_json::{json, Value};
use tauri::async_runtime::spawn_blocking;
use serde::{Deserialize, Serialize};

const DEFAULT_UDP_PORT: u16 = 4003;
const DEFAULT_TIMEOUT_MS: u64 = 1500;
const GOVEE_API_BASE: &str = "https://developer-api.govee.com";

#[derive(Default)]
pub struct GoveeSender;

impl GoveeSender {
    pub async fn send(&self, host: &str, port: Option<u16>, body: &Value) -> BridgeResult<()> {
        let host = host.trim();
        if host.is_empty() {
            return Err(BridgeError::Invalid("Missing host".into()));
        }

        let message = if body.is_string() {
            body.as_str()
                .unwrap_or_default()
                .to_string()
        } else {
            serde_json::to_string(body)
                .map_err(|err| BridgeError::Invalid(format!("Invalid payload: {err}")))?
        };

        let address = format!("{host}:{}", port.unwrap_or(DEFAULT_UDP_PORT));

        spawn_blocking(move || -> BridgeResult<()> {
            let socket = std::net::UdpSocket::bind("0.0.0.0:0")?;
            socket.set_write_timeout(Some(Duration::from_millis(DEFAULT_TIMEOUT_MS)))?;
            socket.send_to(message.as_bytes(), &address)?;
            Ok(())
        })
        .await
        .map_err(|err| BridgeError::Network(err.to_string()))?
    }
}

pub async fn discover(timeout_ms: Option<u64>) -> BridgeResult<Vec<Value>> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(3000));

    spawn_blocking(move || -> BridgeResult<Vec<Value>> {
        use std::net::{Ipv4Addr, SocketAddrV4};

        // Bind to UDP 4002 to receive discovery responses
        let socket = UdpSocket::bind("0.0.0.0:4002")
            .map_err(|e| BridgeError::Network(format!("Failed to bind to UDP 4002: {}", e)))?;

        // Set timeout for receiving responses
        socket.set_read_timeout(Some(Duration::from_millis(100)))
            .map_err(|e| BridgeError::Network(format!("Failed to set read timeout: {}", e)))?;

        // Join multicast group for Govee discovery
        let multicast_addr = Ipv4Addr::new(239, 255, 255, 250);
        socket.join_multicast_v4(&multicast_addr, &Ipv4Addr::UNSPECIFIED)
            .map_err(|e| BridgeError::Network(format!("Failed to join multicast group: {}", e)))?;

        // Send discovery probe to multicast address 239.255.255.250:4001
        let discovery_msg = json!({
            "msg": {
                "cmd": "scan",
                "data": {
                    "account_topic": "reserve"
                }
            }
        });

        let msg_str = serde_json::to_string(&discovery_msg)
            .map_err(|e| BridgeError::Invalid(format!("Failed to serialize discovery message: {}", e)))?;

        let multicast_target = SocketAddrV4::new(multicast_addr, 4001);
        socket.send_to(msg_str.as_bytes(), multicast_target)
            .map_err(|e| BridgeError::Network(format!("Failed to send discovery probe: {}", e)))?;

        println!("📡 Sent Govee discovery probe to {}:4001", multicast_addr);
        println!("🔍 Listening for responses on UDP 4002...");

        // Collect responses
        let mut devices = Vec::new();
        let start_time = std::time::Instant::now();
        let mut buf = [0u8; 2048];

        while start_time.elapsed() < timeout {
            match socket.recv_from(&mut buf) {
                Ok((len, addr)) => {
                    let response_str = String::from_utf8_lossy(&buf[..len]);

                    println!("\n✅ Received response from {}", addr);
                    println!("📦 Raw data: {}", response_str);

                    match serde_json::from_str::<Value>(&response_str) {
                        Ok(response) => {
                            // Extract device info
                            let mut device_info = json!({
                                "source_ip": addr.ip().to_string(),
                                "source_port": addr.port(),
                                "raw_response": response
                            });

                            if let Some(msg) = response.get("msg") {
                                if let Some(data) = msg.get("data") {
                                    // Extract common fields
                                    if let Some(ip) = data.get("ip") {
                                        device_info["ip"] = ip.clone();
                                    }
                                    if let Some(device) = data.get("device") {
                                        // The 'device' field is typically the MAC address
                                        device_info["mac_address"] = device.clone();
                                        device_info["device_id"] = device.clone();
                                    }
                                    if let Some(sku) = data.get("sku") {
                                        device_info["model"] = sku.clone();
                                    }
                                    if let Some(device_name) = data.get("deviceName") {
                                        device_info["name"] = device_name.clone();
                                    }
                                    if let Some(ble_ver) = data.get("bleVersionHard") {
                                        device_info["ble_version"] = ble_ver.clone();
                                    }
                                    if let Some(wifi_ver) = data.get("wifiVersionHard") {
                                        device_info["wifi_version"] = wifi_ver.clone();
                                    }

                                    println!("📱 Device: {}", serde_json::to_string_pretty(&device_info).unwrap_or_default());
                                }
                            }

                            devices.push(device_info);
                        }
                        Err(e) => {
                            println!("⚠️  Failed to parse response: {}", e);
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                    // No response in this iteration, continue waiting
                    continue;
                }
                Err(e) => {
                    println!("⚠️  Error receiving: {}", e);
                    break;
                }
            }
        }

        println!("\n🏁 Discovery complete. Found {} device(s)", devices.len());
        Ok(devices)
    })
    .await
    .map_err(|err| BridgeError::Network(err.to_string()))?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoveeStatus {
    pub online: bool,
    pub power: Option<bool>,
    pub brightness: Option<u8>,
    pub color: Option<GoveeColor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoveeColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// Query the status of a Govee device
pub async fn get_status(host: &str, port: Option<u16>) -> BridgeResult<GoveeStatus> {
    let host = host.trim();
    if host.is_empty() {
        return Err(BridgeError::Invalid("Missing host".into()));
    }

    let address = format!("{}:{}", host, port.unwrap_or(DEFAULT_UDP_PORT));

    spawn_blocking(move || -> BridgeResult<GoveeStatus> {
        let socket = UdpSocket::bind("0.0.0.0:0")
            .map_err(|e| BridgeError::Network(format!("Failed to bind socket: {}", e)))?;

        socket.set_read_timeout(Some(Duration::from_millis(DEFAULT_TIMEOUT_MS)))
            .map_err(|e| BridgeError::Network(format!("Failed to set timeout: {}", e)))?;

        socket.set_write_timeout(Some(Duration::from_millis(DEFAULT_TIMEOUT_MS)))
            .map_err(|e| BridgeError::Network(format!("Failed to set timeout: {}", e)))?;

        // Send status query
        let query = json!({
            "msg": {
                "cmd": "devStatus",
                "data": {}
            }
        });

        let query_str = serde_json::to_string(&query)
            .map_err(|e| BridgeError::Invalid(format!("Failed to serialize query: {}", e)))?;

        socket.send_to(query_str.as_bytes(), &address)
            .map_err(|e| BridgeError::Network(format!("Failed to send query: {}", e)))?;

        // Wait for response
        let mut buf = [0u8; 2048];
        match socket.recv_from(&mut buf) {
            Ok((len, _)) => {
                let response_str = String::from_utf8_lossy(&buf[..len]);
                let response: Value = serde_json::from_str(&response_str)
                    .map_err(|e| BridgeError::Invalid(format!("Invalid response: {}", e)))?;

                // Parse the response
                let mut status = GoveeStatus {
                    online: true,
                    power: None,
                    brightness: None,
                    color: None,
                };

                if let Some(msg) = response.get("msg") {
                    if let Some(data) = msg.get("data") {
                        // Parse power state (onOff: 0=off, 1=on)
                        if let Some(on_off) = data.get("onOff").and_then(|v| v.as_u64()) {
                            status.power = Some(on_off == 1);
                        }

                        // Parse brightness (1-100)
                        if let Some(brightness) = data.get("brightness").and_then(|v| v.as_u64()) {
                            status.brightness = Some(brightness as u8);
                        }

                        // Parse color
                        if let Some(color) = data.get("color") {
                            if let (Some(r), Some(g), Some(b)) = (
                                color.get("r").and_then(|v| v.as_u64()),
                                color.get("g").and_then(|v| v.as_u64()),
                                color.get("b").and_then(|v| v.as_u64()),
                            ) {
                                status.color = Some(GoveeColor {
                                    r: r as u8,
                                    g: g as u8,
                                    b: b as u8,
                                });
                            }
                        }
                    }
                }

                Ok(status)
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                // Device didn't respond - likely offline
                Ok(GoveeStatus {
                    online: false,
                    power: None,
                    brightness: None,
                    color: None,
                })
            }
            Err(e) => {
                Err(BridgeError::Network(format!("Failed to receive response: {}", e)))
            }
        }
    })
    .await
    .map_err(|err| BridgeError::Network(err.to_string()))?
}

/// Cloud HTTP client for Govee API
#[derive(Default)]
pub struct GoveeCloudClient {
    client: reqwest::blocking::Client,
}

impl GoveeCloudClient {
    /// Get devices from Govee cloud API
    pub async fn get_devices(&self, api_key: String) -> BridgeResult<Value> {
        let url = format!("{}/v1/devices", GOVEE_API_BASE);

        spawn_blocking(move || -> BridgeResult<Value> {
            let client = reqwest::blocking::Client::new();
            let response = client
                .get(&url)
                .header("Govee-API-Key", api_key)
                .timeout(Duration::from_secs(10))
                .send()
                .map_err(|e| BridgeError::Network(format!("Failed to fetch devices: {}", e)))?;

            if !response.status().is_success() {
                let status = response.status();
                let error_text = response.text().unwrap_or_default();
                return Err(BridgeError::Network(format!(
                    "API returned error {}: {}",
                    status, error_text
                )));
            }

            let data: Value = response
                .json()
                .map_err(|e| BridgeError::Invalid(format!("Invalid JSON response: {}", e)))?;

            Ok(data)
        })
        .await
        .map_err(|err| BridgeError::Network(err.to_string()))?
    }

    /// Send control command to Govee cloud API
    pub async fn send_command(
        &self,
        api_key: String,
        device: String,
        model: String,
        cmd: Value,
    ) -> BridgeResult<Value> {
        let url = format!("{}/v1/devices/control", GOVEE_API_BASE);

        let payload = json!({
            "device": device,
            "model": model,
            "cmd": cmd
        });

        spawn_blocking(move || -> BridgeResult<Value> {
            let client = reqwest::blocking::Client::new();
            let response = client
                .put(&url)
                .header("Govee-API-Key", api_key)
                .header("Content-Type", "application/json")
                .timeout(Duration::from_secs(10))
                .json(&payload)
                .send()
                .map_err(|e| BridgeError::Network(format!("Failed to send command: {}", e)))?;

            let status = response.status();
            let response_text = response
                .text()
                .map_err(|e| BridgeError::Network(format!("Failed to read response: {}", e)))?;

            // Try to parse as JSON
            let response_json: Value = serde_json::from_str(&response_text)
                .unwrap_or_else(|_| json!({
                    "raw_response": response_text,
                    "status_code": status.as_u16()
                }));

            if !status.is_success() {
                return Err(BridgeError::Network(format!(
                    "API returned error {}: {}",
                    status, serde_json::to_string(&response_json).unwrap_or_default()
                )));
            }

            Ok(response_json)
        })
        .await
        .map_err(|err| BridgeError::Network(err.to_string()))?
    }

    /// Get device state from Govee cloud API
    pub async fn get_device_state(
        &self,
        api_key: String,
        device: String,
        model: String,
    ) -> BridgeResult<Value> {
        let url = format!("{}/v1/devices/state?device={}&model={}", GOVEE_API_BASE, device, model);

        spawn_blocking(move || -> BridgeResult<Value> {
            let client = reqwest::blocking::Client::new();
            let response = client
                .get(&url)
                .header("Govee-API-Key", api_key)
                .timeout(Duration::from_secs(10))
                .send()
                .map_err(|e| BridgeError::Network(format!("Failed to get device state: {}", e)))?;

            if !response.status().is_success() {
                let status = response.status();
                let error_text = response.text().unwrap_or_default();
                return Err(BridgeError::Network(format!(
                    "API returned error {}: {}",
                    status, error_text
                )));
            }

            let data: Value = response
                .json()
                .map_err(|e| BridgeError::Invalid(format!("Invalid JSON response: {}", e)))?;

            Ok(data)
        })
        .await
        .map_err(|err| BridgeError::Network(err.to_string()))?
    }
}
