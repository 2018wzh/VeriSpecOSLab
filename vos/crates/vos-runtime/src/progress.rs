use vos_core::ProgressEvent;

pub type ProgressSink = dyn Fn(ProgressEvent) + Send + Sync;

pub fn emit(progress: Option<&ProgressSink>, stage: &str, message: &str) {
    if let Some(cb) = progress {
        cb(ProgressEvent {
            stage: stage.into(),
            message: message.into(),
            entity_kind: None,
            entity_id: None,
            position: None,
            total: None,
        });
    }
}

pub fn emit_entity(
    progress: Option<&ProgressSink>,
    stage: &str,
    message: &str,
    entity_kind: &str,
    entity_id: Option<&str>,
    position: Option<usize>,
    total: Option<usize>,
) {
    if let Some(cb) = progress {
        cb(ProgressEvent {
            stage: stage.into(),
            message: message.into(),
            entity_kind: Some(entity_kind.into()),
            entity_id: entity_id.map(str::to_string),
            position,
            total,
        });
    }
}
