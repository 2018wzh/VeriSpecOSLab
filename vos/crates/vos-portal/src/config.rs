use std::net::Ipv4Addr;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct PortalConfig {
    pub host: [u8; 4],
    pub port: u16,
    pub database_url: Option<String>,
    pub internal_token: Option<String>,
    pub spec_root: PathBuf,
    pub demo_mode: bool,
}

impl PortalConfig {
    pub fn from_env() -> Self {
        let host = std::env::var("VOS_PORTAL_HOST")
            .ok()
            .and_then(|value| value.parse::<Ipv4Addr>().ok())
            .map(|addr| addr.octets())
            .unwrap_or([127, 0, 0, 1]);
        let port = std::env::var("VOS_PORTAL_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(8080);
        let database_url = std::env::var("DATABASE_URL").ok();
        let internal_token = std::env::var("VOS_PORTAL_INTERNAL_TOKEN").ok();
        let spec_root = std::env::var("VOS_PORTAL_SPEC_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("../examples/xv6-spec/spec"));
        let demo_mode = std::env::var("VOS_PORTAL_DEMO")
            .map(|value| value != "0" && value.to_lowercase() != "false")
            .unwrap_or(true);

        Self {
            host,
            port,
            database_url,
            internal_token,
            spec_root,
            demo_mode,
        }
    }
}
