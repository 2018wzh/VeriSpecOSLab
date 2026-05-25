use indicatif::{ProgressBar, ProgressStyle};
use std::sync::{Arc, Mutex};
use vos_core::{
    CommandEnvelope, CommandStatus, FailurePayload, NotImplementedPayload, ProgressEvent, envelope,
    not_implemented_payload,
};

pub fn make_progress() -> Arc<ProgressBar> {
    let pb = Arc::new(ProgressBar::new_spinner());
    pb.set_style(spinner_style());
    pb.enable_steady_tick(std::time::Duration::from_millis(100));
    pb
}

pub fn make_progress_callback(
    progress: &Arc<ProgressBar>,
) -> Arc<dyn Fn(ProgressEvent) + Send + Sync> {
    let pb = Arc::clone(progress);
    let state = Arc::new(Mutex::new(ProgressRenderState::default()));
    Arc::new(move |event: ProgressEvent| {
        let mut state = state.lock().expect("progress state lock poisoned");
        let rendered_prefix = format_progress_prefix(&event);
        let rendered_message = format_progress_message(&event);

        match progress_mode(&event) {
            ProgressMode::OverallBar(position) => {
                if state.bar_total != Some(100) || !state.overall_bar {
                    pb.set_style(overall_bar_style());
                    pb.set_length(100);
                    state.bar_total = Some(100);
                    state.overall_bar = true;
                }
                pb.set_position(position.min(100));
            }
            ProgressMode::LegacyBar(position, total) => {
                if state.bar_total != Some(total) || state.overall_bar {
                    pb.set_style(legacy_bar_style());
                    pb.set_length(total);
                    state.bar_total = Some(total);
                    state.overall_bar = false;
                }
                pb.set_position(position.min(total));
            }
            ProgressMode::Spinner => {
                if state.bar_total.take().is_some() {
                    pb.set_style(spinner_style());
                    state.overall_bar = false;
                }
            }
        }

        pb.set_prefix(rendered_prefix);
        pb.set_message(rendered_message.clone());
        pb.tick();
        if event.stage == "finished" {
            pb.finish_with_message(rendered_message);
        }
    })
}

#[derive(Default)]
struct ProgressRenderState {
    bar_total: Option<u64>,
    overall_bar: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProgressMode {
    Spinner,
    LegacyBar(u64, u64),
    OverallBar(u64),
}

fn spinner_style() -> ProgressStyle {
    ProgressStyle::with_template("{spinner:.cyan} {prefix:.bold} {msg}")
        .unwrap()
        .tick_strings(&["-", "\\", "|", "/"])
}

fn overall_bar_style() -> ProgressStyle {
    ProgressStyle::with_template(
        "{spinner:.cyan} {prefix:.bold} {bar:24.green/white} {pos:>3}% {msg}",
    )
    .unwrap()
    .progress_chars("=>-")
}

fn legacy_bar_style() -> ProgressStyle {
    ProgressStyle::with_template(
        "{spinner:.cyan} {prefix:.bold} {bar:24.green/white} {pos}/{len} {msg}",
    )
    .unwrap()
    .progress_chars("=>-")
}

fn progress_mode(event: &ProgressEvent) -> ProgressMode {
    if let Some(percent) = event.overall_percent {
        return ProgressMode::OverallBar(u64::from(percent.min(100)));
    }
    match (event.position, event.total) {
        (Some(position), Some(total)) if total > 0 => {
            ProgressMode::LegacyBar(position.min(total) as u64, total as u64)
        }
        _ => ProgressMode::Spinner,
    }
}

fn format_progress_message(event: &ProgressEvent) -> String {
    let status_prefix = progress_status(event)
        .map(|status| format!("{status}: "))
        .unwrap_or_default();
    let entity_suffix = match (&event.entity_kind, &event.entity_id) {
        (Some(kind), Some(id)) => format!(" [{kind}:{id}]"),
        (Some(kind), None) => format!(" [{kind}]"),
        _ => String::new(),
    };
    let counter_suffix = match (event.position, event.total) {
        (Some(position), Some(total)) if total > 0 => {
            let label = counter_label(event.entity_kind.as_deref(), total);
            format!(" ({label} {}/{})", position.min(total), total)
        }
        _ => String::new(),
    };
    format!(
        "{}{}{}{}",
        status_prefix, event.message, entity_suffix, counter_suffix
    )
}

fn progress_status(event: &ProgressEvent) -> Option<&'static str> {
    match event.stage.as_str() {
        "project_skeleton" | "generate_modules" => match event.stage_percent {
            Some(100) => Some("生成中"),
            _ if event.message.contains("generating") => Some("生成中"),
            _ if event.message.contains("completed") || event.message.contains("received") => {
                Some("生成中")
            }
            _ => Some("思考中"),
        },
        "apply_code" => Some("应用中"),
        _ => None,
    }
}

fn format_progress_prefix(event: &ProgressEvent) -> String {
    let stage_name = event
        .stage_label
        .as_deref()
        .filter(|label| !label.is_empty())
        .unwrap_or(&event.stage);
    let stage_percent = event.stage_percent.map(|percent| percent.min(100));
    match (event.stage_index, event.stage_total) {
        (Some(index), Some(total)) if total > 0 => {
            let stage_progress = stage_percent
                .map(|percent| format!(" · {percent}%"))
                .unwrap_or_default();
            format!("[阶段 {index}/{total}{stage_progress}] {stage_name}")
        }
        _ => stage_percent
            .map(|percent| format!("[{percent}%] {stage_name}"))
            .unwrap_or_else(|| stage_name.to_string()),
    }
}

fn counter_label(kind: Option<&str>, total: usize) -> String {
    match kind {
        Some(kind) if kind.ends_with("_id") => kind.to_string(),
        Some(kind) if total > 1 && !kind.ends_with('s') => format!("{kind}s"),
        Some(kind) => kind.to_string(),
        None => "items".into(),
    }
}

pub fn emit_envelope<T: serde::Serialize + std::fmt::Debug>(
    json: bool,
    envelope: CommandEnvelope<T>,
) -> Result<(), String> {
    print_envelope(json, &envelope)
}

pub fn emit_result<T: serde::Serialize + std::fmt::Debug>(
    json: bool,
    command: &str,
    value: Result<CommandEnvelope<T>, String>,
) -> Result<(), String> {
    match value {
        Ok(envelope) => print_envelope(json, &envelope),
        Err(err) => {
            let envelope = envelope(
                command,
                CommandStatus::Failed,
                Vec::new(),
                FailurePayload {
                    kind: "runtime_error".into(),
                    message: err,
                    diagnostics: Vec::new(),
                },
            );
            print_envelope(json, &envelope)
        }
    }
}

pub fn emit_async_result<T: serde::Serialize + std::fmt::Debug>(
    json: bool,
    command: &str,
    value: Result<CommandEnvelope<T>, String>,
) -> Result<(), String> {
    emit_result(json, command, value)
}

pub fn print_envelope<T: serde::Serialize + std::fmt::Debug>(
    json: bool,
    envelope: &CommandEnvelope<T>,
) -> Result<(), String> {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(envelope).map_err(|e| e.to_string())?
        );
    } else {
        println!("{envelope:#?}");
    }
    Ok(())
}

pub fn not_implemented(
    command: &str,
    reason: impl Into<String>,
    related_docs: Vec<String>,
    suggested_next_commands: Vec<String>,
) -> CommandEnvelope<NotImplementedPayload> {
    envelope(
        command,
        CommandStatus::NotImplemented,
        Vec::new(),
        not_implemented_payload(reason, related_docs, suggested_next_commands),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overall_percent_prefers_fixed_hundred_bar() {
        let event = ProgressEvent {
            stage: "build".into(),
            message: "resolving toolchain".into(),
            entity_kind: None,
            entity_id: None,
            position: Some(1),
            total: Some(5),
            stage_label: Some("解析工具链".into()),
            stage_index: Some(1),
            stage_total: Some(5),
            stage_percent: Some(20),
            overall_percent: Some(12),
        };

        assert_eq!(progress_mode(&event), ProgressMode::OverallBar(12));
        assert_eq!(format_progress_prefix(&event), "[阶段 1/5 · 20%] 解析工具链");
        assert_eq!(
            format_progress_message(&event),
            "resolving toolchain (items 1/5)"
        );
    }

    #[test]
    fn falls_back_to_legacy_counter_bar_without_overall_percent() {
        let event = ProgressEvent {
            stage: "generated_module".into(),
            message: "module batch completed".into(),
            entity_kind: Some("module".into()),
            entity_id: Some("memory".into()),
            position: Some(3),
            total: Some(6),
            stage_label: None,
            stage_index: None,
            stage_total: None,
            stage_percent: None,
            overall_percent: None,
        };

        assert_eq!(progress_mode(&event), ProgressMode::LegacyBar(3, 6));
        assert_eq!(format_progress_prefix(&event), "generated_module");
        assert_eq!(
            format_progress_message(&event),
            "module batch completed [module:memory] (modules 3/6)"
        );
    }

    #[test]
    fn agent_progress_messages_include_generation_status() {
        let thinking = ProgressEvent {
            stage: "generate_modules".into(),
            message: "sending module batch prompt".into(),
            entity_kind: Some("module".into()),
            entity_id: Some("proc".into()),
            position: Some(1),
            total: Some(2),
            stage_label: Some("模块批量生成".into()),
            stage_index: Some(4),
            stage_total: Some(6),
            stage_percent: Some(50),
            overall_percent: Some(70),
        };
        assert_eq!(
            format_progress_message(&thinking),
            "思考中: sending module batch prompt [module:proc] (modules 1/2)"
        );

        let applying = ProgressEvent {
            stage: "apply_code".into(),
            message: "wave 1: updated generated editable region".into(),
            entity_kind: Some("file".into()),
            entity_id: Some("kernel/main.c".into()),
            position: Some(1),
            total: Some(1),
            stage_label: Some("应用代码变更".into()),
            stage_index: Some(5),
            stage_total: Some(6),
            stage_percent: Some(100),
            overall_percent: Some(90),
        };
        assert_eq!(
            format_progress_message(&applying),
            "应用中: wave 1: updated generated editable region [file:kernel/main.c] (file 1/1)"
        );
    }

    #[test]
    fn prefix_uses_stage_percent_without_stage_counters() {
        let event = ProgressEvent {
            stage: "project_skeleton".into(),
            message: "requesting skeleton projection".into(),
            entity_kind: None,
            entity_id: None,
            position: None,
            total: None,
            stage_label: Some("骨架投影".into()),
            stage_index: None,
            stage_total: None,
            stage_percent: Some(5),
            overall_percent: Some(17),
        };

        assert_eq!(format_progress_prefix(&event), "[5%] 骨架投影");
    }
}
