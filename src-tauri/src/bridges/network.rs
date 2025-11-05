use std::net::{IpAddr, Ipv4Addr, UdpSocket};

/// Checks if the device is connected to a local network (WiFi or Ethernet)
///
/// This is important for LAN-based protocols like Roku and Govee which
/// require being on the same local network. Mobile data connections
/// won't work for discovering or controlling local devices.
///
/// This implementation uses a simple heuristic: try to bind to a UDP socket
/// and check if we can get a local IP address that's in a private range.
pub fn is_connected_to_wifi() -> Result<bool, String> {
    // Try to get local IP by connecting to a multicast address
    // This doesn't actually send any data, just gets our local IP
    match UdpSocket::bind("0.0.0.0:0") {
        Ok(socket) => {
            // Try to connect to a multicast address (doesn't send data)
            if socket.connect("239.255.255.250:1900").is_ok() {
                if let Ok(addr) = socket.local_addr() {
                    if let IpAddr::V4(ipv4) = addr.ip() {
                        // Check if it's a private network address
                        // Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
                        let is_private = is_private_ipv4(ipv4);
                        return Ok(is_private);
                    }
                }
            }
        }
        Err(e) => {
            return Err(format!("Failed to check network: {}", e));
        }
    }

    // If we can't determine, assume not connected to local network
    Ok(false)
}

fn is_private_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();

    // 10.0.0.0/8
    if octets[0] == 10 {
        return true;
    }

    // 172.16.0.0/12
    if octets[0] == 172 && (16..=31).contains(&octets[1]) {
        return true;
    }

    // 192.168.0.0/16
    if octets[0] == 192 && octets[1] == 168 {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn test_private_ip_detection() {
        assert!(is_private_ipv4(Ipv4Addr::new(192, 168, 1, 1)));
        assert!(is_private_ipv4(Ipv4Addr::new(10, 0, 0, 1)));
        assert!(is_private_ipv4(Ipv4Addr::new(172, 16, 0, 1)));
        assert!(!is_private_ipv4(Ipv4Addr::new(8, 8, 8, 8)));
    }

    #[test]
    fn test_wifi_detection() {
        // Just verify it doesn't crash
        let result = is_connected_to_wifi();
        assert!(result.is_ok());
    }
}
