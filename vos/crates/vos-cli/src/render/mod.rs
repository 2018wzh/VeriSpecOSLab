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
        let entity = match (&event.entity_kind, &event.entity_id) {
            (Some(kind), Some(id)) => format!(" [{kind}:{id}]"),
            (Some(kind), None) => format!(" [{kind}]"),
            _ => String::new(),
        };
        let counter = match (event.position, event.total) {
            (Some(position), Some(total)) => format!(" ({position}/{total})"),
            _ => String::new(),
        };
        let rendered = format!("{}{}{}: {}", event.stage, counter, entity, event.message);
        let event_key = format!(
            "{}|{}|{}|{}|{}|{}",
            event.stage,
            event.message,
            event.entity_kind.as_deref().unwrap_or_default(),
            event.entity_id.as_deref().unwrap_or_default(),
            event.position.unwrap_or_default(),
            event.total.unwrap_or_default()
        );
        let sticky_line = format!("[progress] {rendered}");

        match (event.position, event.total) {
            (Some(position), Some(total)) if total > 0 => {
                if state.bar_total != Some(total as u64) {
                    pb.set_style(bar_style());
                    pb.set_length(total as u64);
                    state.bar_total = Some(total as u64);
                }
                pb.set_position(position.min(total) as u64);
            }
            _ => {
                if state.bar_total.take().is_some() {
                    pb.set_style(spinner_style());
                }
            }
        }

        if state.last_printed.as_deref() != Some(&event_key) {
            pb.println(sticky_line);
            state.last_printed = Some(event_key);
        }

        pb.set_message(rendered);
        pb.tick();
        if event.stage == "finished" {
            pb.finish_with_message("finished");
        }
    })
}

#[derive(Default)]
struct ProgressRenderState {
    last_printed: Option<String>,
    bar_total: Option<u64>,
}

fn spinner_style() -> ProgressStyle {
    ProgressStyle::with_template("{spinner:.green} {msg}")
        .unwrap()
        .tick_strings(&["-", "\\", "|", "/"])
}

fn bar_style() -> ProgressStyle {
    ProgressStyle::with_template("{bar:30.green/white} {pos}/{len} {msg}").unwrap()
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
