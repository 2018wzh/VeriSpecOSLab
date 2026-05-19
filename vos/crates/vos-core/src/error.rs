use thiserror::Error;

pub type Result<T> = std::result::Result<T, VosError>;

#[derive(Debug, Error)]
pub enum VosError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("yaml error: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("toml parse error: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("toml serialize error: {0}")]
    TomlSer(#[from] toml::ser::Error),
    #[error("timeout: {0}")]
    Timeout(String),
    #[error("transport error: {0}")]
    Transport(String),
    #[error("{0}")]
    Message(String),
}
