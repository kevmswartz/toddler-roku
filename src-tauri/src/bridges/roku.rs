use std::time::Duration;
use std::net::{UdpSocket, SocketAddr};

use crate::error::{BridgeError, BridgeResult};
use reqwest::blocking::Client;
use tauri::async_runtime::spawn_blocking;
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct RokuHttpClient {
    client: Client,
}

impl Default for RokuHttpClient {
    fn default() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(6))
            .danger_accept_invalid_certs(true)
            .build()
            .expect("Failed to create Roku HTTP client");
        Self { client }
    }
}

impl RokuHttpClient {
    pub async fn get(&self, url: &str) -> BridgeResult<String> {
        let client = self.client.clone();
        let target = url.to_string();

        spawn_blocking(move || -> BridgeResult<String> {
            let response = client
                .get(target)
                .send()
                .map_err(BridgeError::from)?
                .error_for_status()
                .map_err(BridgeError::from)?;
            response.text().map_err(BridgeError::from)
        })
        .await
        .map_err(|err| BridgeError::Network(err.to_string()))?
    }

    pub async fn post(&self, url: &str, body: Option<&str>) -> BridgeResult<()> {
        let client = self.client.clone();
        let target = url.to_string();
        let payload = body.map(|b| b.to_string()).unwrap_or_else(String::new);

        spawn_blocking(move || -> BridgeResult<()> {
            let mut request = client.post(target);
            if !payload.is_empty() {
                request = request.body(payload.clone());
            }

            request
                .send()
                .map_err(BridgeError::from)?
                .error_for_status()
                .map_err(BridgeError::from)?;
            Ok(())
        })
        .await
        .map_err(|err| BridgeError::Network(err.to_string()))?
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RokuDevice {
    pub ip: String,
    pub location: String,
    pub usn: Option<String>,
    pub serial_number: Option<String>,
    pub device_id: Option<String>,
    pub model_name: Option<String>,
    pub friendly_name: Option<String>,
}

/// Discover Roku devices on the local network using SSDP
pub async fn discover_roku_devices(timeout_secs: Option<u64>) -> BridgeResult<Vec<RokuDevice>> {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(3));

    spawn_blocking(move || -> BridgeResult<Vec<RokuDevice>> {
        let socket = UdpSocket::bind("0.0.0.0:0")
            .map_err(|e| BridgeError::Network(format!("Failed to bind UDP socket: {}", e)))?;

        socket.set_read_timeout(Some(timeout))
            .map_err(|e| BridgeError::Network(format!("Failed to set timeout: {}", e)))?;

        socket.set_broadcast(true)
            .map_err(|e| BridgeError::Network(format!("Failed to enable broadcast: {}", e)))?;

        // SSDP M-SEARCH request for Roku devices
        let search_msg = format!(
            "M-SEARCH * HTTP/1.1\r\n\
             HOST: 239.255.255.250:1900\r\n\
             MAN: \"ssdp:discover\"\r\n\
             MX: 3\r\n\
             ST: roku:ecp\r\n\
             \r\n"
        );

        let multicast_addr: SocketAddr = "239.255.255.250:1900".parse()
            .map_err(|e| BridgeError::Network(format!("Invalid multicast address: {}", e)))?;

        socket.send_to(search_msg.as_bytes(), multicast_addr)
            .map_err(|e| BridgeError::Network(format!("Failed to send SSDP request: {}", e)))?;

        let mut devices = Vec::new();
        let mut buf = [0u8; 2048];
        let start = std::time::Instant::now();

        while start.elapsed() < timeout {
            match socket.recv_from(&mut buf) {
                Ok((len, _addr)) => {
                    let response = String::from_utf8_lossy(&buf[..len]);

                    // Parse SSDP response
                    if response.contains("roku:ecp") {
                        let mut location = String::new();
                        let mut usn = None;

                        for line in response.lines() {
                            let line = line.trim();
                            if line.to_lowercase().starts_with("location:") {
                                location = line[9..].trim().to_string();
                            } else if line.to_lowercase().starts_with("usn:") {
                                usn = Some(line[4..].trim().to_string());
                            }
                        }

                        // Extract IP from location URL
                        if !location.is_empty() {
                            if let Some(ip) = extract_ip_from_url(&location) {
                                // Avoid duplicates
                                if !devices.iter().any(|d: &RokuDevice| d.ip == ip) {
                                    let device = RokuDevice {
                                        ip: ip.to_string(),
                                        location: location.clone(),
                                        usn,
                                        serial_number: None,
                                        device_id: None,
                                        model_name: None,
                                        friendly_name: None,
                                    };
                                    devices.push(device);
                                }
                            }
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => {
                    // Timeout, continue waiting
                    continue;
                }
                Err(e) => {
                    // Other errors, log but don't fail completely
                    eprintln!("SSDP receive error: {}", e);
                    break;
                }
            }
        }

        // Enrich devices with device info
        println!("📡 Found {} Roku device(s), fetching details...", devices.len());
        for device in devices.iter_mut() {
            if let Ok(info) = fetch_device_info(&device.ip) {
                device.serial_number = info.serial_number;
                device.device_id = info.device_id;
                device.model_name = info.model_name;
                device.friendly_name = info.friendly_name;
                println!("✅ {} - Serial: {:?}", device.ip, device.serial_number);
            }
        }

        Ok(devices)
    })
    .await
    .map_err(|err| BridgeError::Network(err.to_string()))?
}

fn fetch_device_info(ip: &str) -> BridgeResult<RokuDeviceInfo> {
    let url = format!("http://{}:8060/query/device-info", ip);
    let client = Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| BridgeError::Network(format!("HTTP client error: {}", e)))?;

    let response = client.get(&url)
        .send()
        .map_err(|e| BridgeError::Network(format!("Failed to fetch device info: {}", e)))?
        .text()
        .map_err(|e| BridgeError::Network(format!("Failed to read response: {}", e)))?;

    parse_device_info(&response)
}

#[derive(Debug)]
struct RokuDeviceInfo {
    serial_number: Option<String>,
    device_id: Option<String>,
    model_name: Option<String>,
    friendly_name: Option<String>,
}

fn parse_device_info(xml: &str) -> BridgeResult<RokuDeviceInfo> {
    let mut info = RokuDeviceInfo {
        serial_number: None,
        device_id: None,
        model_name: None,
        friendly_name: None,
    };

    // Simple XML parsing - extract tags we need
    if let Some(serial) = extract_xml_tag(xml, "serial-number") {
        info.serial_number = Some(serial);
    }
    if let Some(device_id) = extract_xml_tag(xml, "device-id") {
        info.device_id = Some(device_id);
    }
    if let Some(model) = extract_xml_tag(xml, "model-name") {
        info.model_name = Some(model);
    }
    if let Some(name) = extract_xml_tag(xml, "user-device-name") {
        info.friendly_name = Some(name);
    } else if let Some(name) = extract_xml_tag(xml, "friendly-device-name") {
        info.friendly_name = Some(name);
    }

    Ok(info)
}

fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);

    if let Some(start_pos) = xml.find(&start_tag) {
        let content_start = start_pos + start_tag.len();
        if let Some(end_pos) = xml[content_start..].find(&end_tag) {
            return Some(xml[content_start..content_start + end_pos].trim().to_string());
        }
    }
    None
}

fn extract_ip_from_url(url: &str) -> Option<&str> {
    // Extract IP from URL like "http://192.168.1.100:8060/"
    if let Some(start) = url.find("://") {
        let after_scheme = &url[start + 3..];
        if let Some(end) = after_scheme.find(':') {
            return Some(&after_scheme[..end]);
        } else if let Some(end) = after_scheme.find('/') {
            return Some(&after_scheme[..end]);
        }
    }
    None
}
