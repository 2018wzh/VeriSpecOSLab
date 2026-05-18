pub fn summarize_program_command(
    program: &str,
    args: &[String],
    trailing_target: Option<&str>,
) -> String {
    let mut rendered = format!("{program} {:?}", args);
    if let Some(target) = trailing_target {
        rendered.push_str(" => ");
        rendered.push_str(target);
    }
    rendered
}
