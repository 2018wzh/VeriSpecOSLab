use vos_core::ProgressEvent;

pub type ProgressSink = dyn Fn(ProgressEvent) + Send + Sync;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProgressStageDefinition {
    pub key: &'static str,
    pub label: &'static str,
    pub weight: u8,
}

#[derive(Debug, Clone)]
pub struct ProgressPlan {
    stages: Vec<ProgressStageDefinition>,
    total_weight: u32,
}

impl ProgressPlan {
    pub fn new(stages: Vec<ProgressStageDefinition>) -> Self {
        let total_weight = stages.iter().map(|stage| u32::from(stage.weight)).sum();
        Self {
            stages,
            total_weight,
        }
    }

    pub fn stage_count(&self) -> usize {
        self.stages.len()
    }

    pub fn emit_stage(&self, progress: Option<&ProgressSink>, stage: &str, message: &str) {
        self.emit_stage_progress(progress, stage, message, 0, None, None, None, None);
    }

    pub fn finish_stage(&self, progress: Option<&ProgressSink>, stage: &str, message: &str) {
        self.emit_stage_progress(progress, stage, message, 100, None, None, None, None);
    }

    pub fn emit_stage_count(
        &self,
        progress: Option<&ProgressSink>,
        stage: &str,
        message: &str,
        entity_kind: Option<&str>,
        entity_id: Option<&str>,
        position: usize,
        total: usize,
    ) {
        let stage_percent = progress_percent(position, total).unwrap_or(0);
        self.emit_stage_progress(
            progress,
            stage,
            message,
            stage_percent,
            entity_kind,
            entity_id,
            Some(position),
            Some(total),
        );
    }

    pub fn emit_stage_progress(
        &self,
        progress: Option<&ProgressSink>,
        stage: &str,
        message: &str,
        stage_percent: u8,
        entity_kind: Option<&str>,
        entity_id: Option<&str>,
        position: Option<usize>,
        total: Option<usize>,
    ) {
        let Some((stage_def, stage_index)) = self.stage(stage) else {
            emit(progress, stage, message);
            return;
        };
        let bounded_stage_percent = stage_percent.min(100);
        emit_event(
            progress,
            ProgressEvent {
                stage: stage.to_string(),
                message: message.to_string(),
                entity_kind: entity_kind.map(str::to_string),
                entity_id: entity_id.map(str::to_string),
                position,
                total,
                stage_label: Some(stage_def.label.to_string()),
                stage_index: Some(stage_index + 1),
                stage_total: Some(self.stage_count()),
                stage_percent: Some(bounded_stage_percent),
                overall_percent: Some(
                    self.overall_percent_for_stage(stage_index, bounded_stage_percent),
                ),
            },
        );
    }

    pub fn finish(&self, progress: Option<&ProgressSink>, message: &str) {
        let stage_total = self.stage_count();
        emit_event(
            progress,
            ProgressEvent {
                stage: "finished".into(),
                message: message.into(),
                entity_kind: None,
                entity_id: None,
                position: None,
                total: None,
                stage_label: Some("完成".into()),
                stage_index: Some(stage_total),
                stage_total: Some(stage_total),
                stage_percent: Some(100),
                overall_percent: Some(100),
            },
        );
    }

    fn stage(&self, key: &str) -> Option<(ProgressStageDefinition, usize)> {
        self.stages
            .iter()
            .copied()
            .enumerate()
            .find_map(|(idx, stage)| (stage.key == key).then_some((stage, idx)))
    }

    fn overall_percent_for_stage(&self, stage_index: usize, stage_percent: u8) -> u8 {
        if self.total_weight == 0 {
            return stage_percent.min(100);
        }
        let completed_weight: u32 = self
            .stages
            .iter()
            .take(stage_index)
            .map(|stage| u32::from(stage.weight))
            .sum();
        let stage_weight = u32::from(self.stages[stage_index].weight);
        let numerator = completed_weight * 100 + stage_weight * u32::from(stage_percent.min(100));
        ((numerator + (self.total_weight / 2)) / self.total_weight).min(100) as u8
    }
}

pub fn emit(progress: Option<&ProgressSink>, stage: &str, message: &str) {
    emit_event(
        progress,
        ProgressEvent {
            stage: stage.into(),
            message: message.into(),
            entity_kind: None,
            entity_id: None,
            position: None,
            total: None,
            stage_label: None,
            stage_index: None,
            stage_total: None,
            stage_percent: None,
            overall_percent: None,
        },
    );
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
    emit_event(
        progress,
        ProgressEvent {
            stage: stage.into(),
            message: message.into(),
            entity_kind: Some(entity_kind.into()),
            entity_id: entity_id.map(str::to_string),
            position,
            total,
            stage_label: None,
            stage_index: None,
            stage_total: None,
            stage_percent: None,
            overall_percent: None,
        },
    );
}

pub fn remap_child_event(
    progress: Option<&ProgressSink>,
    parent_plan: &ProgressPlan,
    parent_stage: &str,
    child_event: ProgressEvent,
) {
    let Some((stage_def, stage_index)) = parent_plan.stage(parent_stage) else {
        emit_event(progress, child_event);
        return;
    };
    let stage_percent = child_event
        .overall_percent
        .or(child_event.stage_percent)
        .or_else(|| match (child_event.position, child_event.total) {
            (Some(position), Some(total)) => progress_percent(position, total),
            _ => None,
        })
        .unwrap_or_else(|| {
            if child_event.stage == "finished" {
                100
            } else {
                0
            }
        });
    let detail_message = child_stage_detail(&child_event, stage_def.label);
    emit_event(
        progress,
        ProgressEvent {
            stage: parent_stage.to_string(),
            message: detail_message,
            entity_kind: child_event.entity_kind,
            entity_id: child_event.entity_id,
            position: child_event.position,
            total: child_event.total,
            stage_label: Some(stage_def.label.to_string()),
            stage_index: Some(stage_index + 1),
            stage_total: Some(parent_plan.stage_count()),
            stage_percent: Some(stage_percent.min(100)),
            overall_percent: Some(
                parent_plan.overall_percent_for_stage(stage_index, stage_percent),
            ),
        },
    );
}

fn emit_event(progress: Option<&ProgressSink>, event: ProgressEvent) {
    if let Some(cb) = progress {
        cb(event);
    }
}

fn child_stage_detail(event: &ProgressEvent, parent_label: &str) -> String {
    match event.stage_label.as_deref() {
        Some(label) if !label.is_empty() && label != parent_label && label != "完成" => {
            format!("{label}: {}", event.message)
        }
        _ => event.message.clone(),
    }
}

pub fn progress_percent(position: usize, total: usize) -> Option<u8> {
    if total == 0 {
        return None;
    }
    Some(((position.min(total) * 100) / total).min(100) as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_plan() -> ProgressPlan {
        ProgressPlan::new(vec![
            ProgressStageDefinition {
                key: "prepare",
                label: "准备",
                weight: 15,
            },
            ProgressStageDefinition {
                key: "execute",
                label: "执行",
                weight: 55,
            },
            ProgressStageDefinition {
                key: "finish",
                label: "收尾",
                weight: 30,
            },
        ])
    }

    #[test]
    fn progress_plan_reports_exact_stage_count() {
        let plan = sample_plan();
        assert_eq!(plan.stage_count(), 3);
        assert_eq!(plan.total_weight, 100);
    }

    #[test]
    fn overall_percent_tracks_stage_boundaries() {
        let plan = sample_plan();
        assert_eq!(plan.overall_percent_for_stage(0, 0), 0);
        assert_eq!(plan.overall_percent_for_stage(0, 100), 15);
        assert_eq!(plan.overall_percent_for_stage(1, 50), 43);
        assert_eq!(plan.overall_percent_for_stage(1, 100), 70);
        assert_eq!(plan.overall_percent_for_stage(2, 100), 100);
    }

    #[test]
    fn progress_percent_uses_integer_counts() {
        assert_eq!(progress_percent(0, 4), Some(0));
        assert_eq!(progress_percent(1, 4), Some(25));
        assert_eq!(progress_percent(4, 4), Some(100));
        assert_eq!(progress_percent(5, 4), Some(100));
        assert_eq!(progress_percent(1, 0), None);
    }

    #[test]
    fn remapped_child_event_uses_parent_stage_range() {
        let plan = sample_plan();
        let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured_for_sink = std::sync::Arc::clone(&captured);
        let sink =
            move |event: ProgressEvent| captured_for_sink.lock().expect("capture lock").push(event);
        remap_child_event(
            Some(&sink),
            &plan,
            "execute",
            ProgressEvent {
                stage: "building_system".into(),
                message: "running phase".into(),
                entity_kind: None,
                entity_id: None,
                position: Some(2),
                total: Some(4),
                stage_label: Some("执行 build phases".into()),
                stage_index: Some(4),
                stage_total: Some(5),
                stage_percent: Some(50),
                overall_percent: Some(50),
            },
        );

        let event = captured
            .lock()
            .expect("capture lock")
            .pop()
            .expect("mapped event");
        assert_eq!(event.stage, "execute");
        assert_eq!(event.stage_label.as_deref(), Some("执行"));
        assert_eq!(event.stage_index, Some(2));
        assert_eq!(event.stage_total, Some(3));
        assert_eq!(event.stage_percent, Some(50));
        assert_eq!(event.overall_percent, Some(43));
        assert_eq!(event.message, "执行 build phases: running phase");
    }
}
