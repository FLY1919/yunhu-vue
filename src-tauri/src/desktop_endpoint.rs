//! Loopback endpoint allocation. Never reuse a listener owned by another process.
use std::net::TcpListener;
pub fn select_port(preferred: u16) -> std::io::Result<u16> {
    for port in preferred..=preferred.saturating_add(32) {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) { return Ok(listener.local_addr()?.port()); }
    }
    Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}
pub fn proof_request(port: u16, nonce: &str) -> String {
    format!("GET /bot-ai/proof?nonce={nonce} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
}
pub fn proof_matches(response: &str, expected: &str) -> bool {
    let Some((head, body)) = response.split_once("\r\n\r\n") else { return false };
    (head.starts_with("HTTP/1.1 200 ") || head.starts_with("HTTP/1.0 200 ")) && body.trim() == expected
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn proof_uses_the_selected_port() {
        let request = proof_request(54321, "nonce");
        assert!(request.contains("Host: 127.0.0.1:54321\r\n"));
    }
    #[test] fn occupied_port_is_never_reused() {
        let occupied = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = occupied.local_addr().unwrap().port();
        let chosen = select_port(port).unwrap();
        assert_ne!(port, chosen);
        assert!(TcpListener::bind(("127.0.0.1", chosen)).is_ok());
    }
    #[test] fn identity_proof_rejects_wrong_or_incomplete_server() {
        assert!(proof_matches("HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc", "abc"));
        assert!(!proof_matches("HTTP/1.1 200 OK\r\n\r\nold-secret", "new-secret"));
        assert!(!proof_matches("HTTP/1.1 403 Forbidden\r\n\r\nabc", "abc"));
        assert!(!proof_matches("HTTP/1.1 200 OK", "abc"));
    }
}
