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
    pub stage_label: Option<String>,
    pub stage_index: Option<usize>,
    pub stage_total: Option<usize>,
    pub stage_percent: Option<u8>,
    pub overall_percent: Option<u8>,
}

pub fn new_run_id() -> String {
    Uuid::new_v4().to_string()
}
