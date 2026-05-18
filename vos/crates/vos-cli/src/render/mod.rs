use indicatif::{ProgressBar, ProgressStyle};
use std::sync::Arc;
use vos_core::{
    CommandEnvelope, CommandStatus, FailurePayload, NotImplementedPayload, ProgressEvent, envelope,
    not_implemented_payload,
};

pub fn make_progress() -> Arc<ProgressBar> {
    let pb = Arc::new(ProgressBar::new_spinner());
    pb.set_style(
        ProgressStyle::with_template("{spinner:.green} {msg}")
            .unwrap()
            .tick_strings(&["-", "\\", "|", "/"]),
    );
    pb.enable_steady_tick(std::time::Duration::from_millis(100));
    pb
}

pub fn make_progress_callback(
    progress: &Arc<ProgressBar>,
) -> Arc<dyn Fn(ProgressEvent) + Send + Sync> {
    let pb = Arc::clone(progress);
    Arc::new(move |event: ProgressEvent| {
        let entity = match (&event.entity_kind, &event.entity_id) {
            (Some(kind), Some(id)) => format!(" [{kind}:{id}]"),
            (Some(kind), None) => format!(" [{kind}]"),
            _ => String::new(),
        };
        let counter = match (event.position, event.total) {
            (Some(position), Some(total)) => format!(" ({position}/{total})"),
            _ => String::new(),
        };
        pb.set_message(format!(
            "{}{}{}: {}",
            event.stage, counter, entity, event.message
        ));
        pb.tick();
        if event.stage == "finished" {
            pb.finish_and_clear();
        }
    })
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
