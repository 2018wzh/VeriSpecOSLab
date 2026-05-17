use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressEvent {
    pub stage: String,
    pub message: String,
    pub entity_kind: Option<String>,
    pub entity_id: Option<String>,
    pub position: Option<usize>,
    pub total: Option<usize>,
}

pub fn new_run_id() -> String {
    Uuid::new_v4().to_string()
}
