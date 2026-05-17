use std::path::{Path, PathBuf};
use vos_core::{
    ArchitectureComposeResult, ConcurrencySpec, ContextBundle, ModuleBatchCodegenResponse,
    ModuleSpec, NormalizedSpecBundle, OperationContract, PlanDraft, PromptEnvelope,
    SkeletonProjectionResponse, SpecBundle, SpecRef, ToolchainSpecBundle,
};

pub fn build_prompt(
    bundle: &SpecBundle,
    toolchain: Option<&ToolchainSpecBundle>,
    phase: &str,
    project_root: &Path,
) -> PromptEnvelope {
    build_single_operation_prompt(bundle, toolchain, phase, project_root)
}

pub fn build_single_operation_prompt(
    bundle: &SpecBundle,
    toolchain: Option<&ToolchainSpecBundle>,
    phase: &str,
    project_root: &Path,
) -> PromptEnvelope {
    let editable = &bundle.operation_contract.llm_codegen.editable_region;
    let allowed_paths = vec![project_root.join(&editable.file)];
    let prompt = format!(
        "You are generating OS code for a single operation.\n\
Task kind: single_operation_codegen\n\
Phase: {phase}\n\
Module: {module}\n\
Operation: {operation}\n\
\n\
Rules:\n\
- Only modify the editable region between the exact start and end markers.\n\
- Return code only in one fenced code block.\n\
- Do not create new files.\n\
- Do not change files outside the allowed path.\n\
\n\
Editable target:\n\
file: {file}\n\
start_marker: {start}\n\
end_marker: {end}\n\
\n\
MODULE SPEC\n\
purpose: {module_purpose}\n\
owned_state:\n{owned_state}\n\
exported_interfaces:\n{exported_interfaces}\n\
imported_interfaces:\n{imported_interfaces}\n\
module_invariants:\n{module_invariants}\n\
\n\
OPERATION CONTRACT\n\
purpose: {operation_purpose}\n\
rely:\n{rely}\n\
guarantee:\n{guarantee}\n\
preconditions:\n{preconditions}\n\
postconditions:\n{postconditions}\n\
invariants_preserved:\n{invariants_preserved}\n\
failure_semantics:\n{failure_semantics}\n\
security:\n{security}\n\
concurrency:\n{concurrency}\n\
test_obligations:\n{test_obligations}\n\
\n\
TOOLCHAIN\n\
{toolchain}\n",
        phase = phase,
        module = bundle.module_spec.module,
        operation = bundle.operation_contract.operation,
        file = editable.file.display(),
        start = editable.start_marker,
        end = editable.end_marker,
        module_purpose = bundle.module_spec.purpose,
        owned_state = yaml_lines(&bundle.module_spec.owned_state),
        exported_interfaces = yaml_lines(&bundle.module_spec.exported_interfaces),
        imported_interfaces = yaml_lines(&bundle.module_spec.imported_interfaces),
        module_invariants = yaml_lines(&bundle.module_spec.module_invariants),
        operation_purpose = bundle.operation_contract.purpose,
        rely = serde_yaml::to_string(&bundle.operation_contract.rely).unwrap_or_default(),
        guarantee = serde_yaml::to_string(&bundle.operation_contract.guarantee).unwrap_or_default(),
        preconditions = yaml_lines(&bundle.operation_contract.preconditions),
        postconditions = yaml_lines(&bundle.operation_contract.postconditions),
        invariants_preserved = yaml_lines(&bundle.operation_contract.invariants_preserved),
        failure_semantics =
            serde_yaml::to_string(&bundle.operation_contract.failure_semantics).unwrap_or_default(),
        security = serde_yaml::to_string(&bundle.operation_contract.security).unwrap_or_default(),
        concurrency =
            serde_yaml::to_string(&bundle.operation_contract.concurrency).unwrap_or_default(),
        test_obligations =
            serde_yaml::to_string(&bundle.operation_contract.test_obligations).unwrap_or_default(),
        toolchain = toolchain_summary(toolchain),
    );

    PromptEnvelope {
        task_kind: "single_operation_codegen".into(),
        phase: phase.into(),
        spec_ref: SpecRef {
            module: bundle.module_spec.module.clone(),
            operation: bundle.operation_contract.operation.clone(),
        },
        allowed_paths,
        prompt,
    }
}

pub fn build_skeleton_projection_prompt(
    normalized: &NormalizedSpecBundle,
    compose: &ArchitectureComposeResult,
    project_root: &Path,
) -> PromptEnvelope {
    let toolchain = &normalized.architecture.toolchain;
    let allowed_paths = allowed_paths_from_spec(normalized, project_root);
    let prompt = format!(
        "You are projecting an operating system skeleton from strict architecture, module, and toolchain specs.\n\
Task kind: skeleton_projection\n\
Return one JSON code block matching this shape exactly:\n\
{{\"files_to_create\":[{{\"path\":\"...\",\"content\":\"...\",\"create_mode\":\"create\"}}],\"files_to_update\":[{{\"file\":\"...\",\"start_marker\":\"...\",\"end_marker\":\"...\",\"code\":\"...\"}}]}}\n\
\n\
Rules:\n\
- You may only create files whose paths are implied by build.sources, build.include_paths, link.linker_script, debug.gdb_script, or operation editable targets.\n\
- Do not emit explanations outside the JSON block.\n\
- Do not fill subsystem logic beyond minimal skeletons, signatures, entry points, linker files, and placeholder regions.\n\
\n\
CURRENT STAGE\n\
{stage}\n\
\n\
ARCHITECTURE SUMMARY\n\
{arch_summary}\n\
\n\
ENABLED MODULES\n\
{modules}\n\
\n\
SKELETON FEATURES\n\
{features}\n\
\n\
MODULE DEPENDENCY DAG\n\
{dag}\n\
\n\
TOOLCHAIN\n\
target_triple: {target_triple}\n\
c_compiler: {c_compiler}\n\
asm_compiler: {asm_compiler}\n\
linker: {linker}\n\
linker_script: {linker_script}\n\
output_artifacts:\n{artifacts}\n\
run_emulator: {emulator}\n\
kernel_arg: {kernel_arg}\n\
allowed_paths:\n{allowed}\n",
        stage = compose.current_stage,
        arch_summary = normalized.architecture.seed.architecture_summary,
        modules = yaml_lines(&compose.enabled_modules),
        features = yaml_lines(&compose.skeleton_features),
        dag = compose
            .module_dependency_dag
            .iter()
            .map(|(module, deps)| format!("- {module}: {}", deps.join(", ")))
            .collect::<Vec<_>>()
            .join("\n"),
        target_triple = toolchain.toolchain.target_triple,
        c_compiler = toolchain.toolchain.c_compiler,
        asm_compiler = toolchain.toolchain.asm_compiler,
        linker = toolchain.toolchain.linker,
        linker_script = toolchain.link.linker_script.display(),
        artifacts = yaml_paths(&toolchain.build.generated_artifacts),
        emulator = toolchain.run.emulator,
        kernel_arg = toolchain.run.kernel_arg,
        allowed = yaml_paths(
            &allowed_paths
                .iter()
                .map(|path| path.strip_prefix(project_root).unwrap_or(path).to_path_buf())
                .collect::<Vec<_>>(),
        ),
    );

    PromptEnvelope {
        task_kind: "skeleton_projection".into(),
        phase: "skeleton_projection".into(),
        spec_ref: SpecRef {
            module: "architecture".into(),
            operation: compose.current_stage.clone(),
        },
        allowed_paths,
        prompt,
    }
}

pub fn build_module_codegen_batch_prompt(
    module_spec: &ModuleSpec,
    operations: &[OperationContract],
    concurrency: Option<&ConcurrencySpec>,
    normalized: &NormalizedSpecBundle,
    project_root: &Path,
) -> PromptEnvelope {
    let allowed_paths = operations
        .iter()
        .map(|op| project_root.join(&op.llm_codegen.editable_region.file))
        .collect::<Vec<_>>();
    let prompt = format!(
        "You are generating one module worth of OS code from strict specs.\n\
Task kind: module_codegen_batch\n\
Return one JSON code block matching this shape exactly:\n\
{{\"region_edits\":[{{\"file\":\"...\",\"start_marker\":\"...\",\"end_marker\":\"...\",\"code\":\"...\"}}]}}\n\
\n\
Rules:\n\
- You may only write region edits for the listed operations in this module.\n\
- Do not create new files.\n\
- Emit one region edit per editable region.\n\
- Do not emit explanations outside the JSON block.\n\
\n\
MODULE SPEC\n\
id: {id}\n\
module: {module}\n\
stage: {stage}\n\
purpose: {purpose}\n\
owned_state:\n{owned_state}\n\
exported_interfaces:\n{exported_interfaces}\n\
imported_interfaces:\n{imported_interfaces}\n\
module_invariants:\n{module_invariants}\n\
error_model:\n{error_model}\n\
resource_lifetime_rules:\n{resource_lifetime_rules}\n\
security_boundary:\n{security_boundary}\n\
test_surfaces:\n{test_surfaces}\n\
\n\
CONCURRENCY SPEC\n\
{concurrency}\n\
\n\
OPERATIONS\n\
{operations}\n\
\n\
GLOBAL ARCHITECTURE SUMMARY\n\
{arch_summary}\n\
\n\
ALLOWED REGION TARGETS\n\
{targets}\n",
        id = module_spec.id,
        module = module_spec.module,
        stage = module_spec.stage,
        purpose = module_spec.purpose,
        owned_state = yaml_lines(&module_spec.owned_state),
        exported_interfaces = yaml_lines(&module_spec.exported_interfaces),
        imported_interfaces = yaml_lines(&module_spec.imported_interfaces),
        module_invariants = yaml_lines(&module_spec.module_invariants),
        error_model = yaml_lines(&module_spec.error_model),
        resource_lifetime_rules = yaml_lines(&module_spec.resource_lifetime_rules),
        security_boundary = yaml_lines(&module_spec.security_boundary),
        test_surfaces = yaml_lines(&module_spec.test_surfaces),
        concurrency = concurrency
            .map(|spec| serde_yaml::to_string(spec).unwrap_or_default())
            .unwrap_or_else(|| "null".into()),
        operations = operations
            .iter()
            .map(operation_block)
            .collect::<Vec<_>>()
            .join("\n\n"),
        arch_summary = normalized.architecture.seed.architecture_summary,
        targets = operations
            .iter()
            .map(|op| {
                format!(
                    "- file: {}\n  start_marker: {}\n  end_marker: {}",
                    op.llm_codegen.editable_region.file.display(),
                    op.llm_codegen.editable_region.start_marker,
                    op.llm_codegen.editable_region.end_marker
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
    );

    PromptEnvelope {
        task_kind: "module_codegen_batch".into(),
        phase: "module_codegen_batch".into(),
        spec_ref: SpecRef {
            module: module_spec.module.clone(),
            operation: "batch".into(),
        },
        allowed_paths,
        prompt,
    }
}

pub fn build_agent_context_prompt(context: &ContextBundle, plan: Option<&PlanDraft>) -> PromptEnvelope {
    let prompt = format!(
        "Context scope: {}\nVisibility: {}\nResolved specs:\n{}\nRecent evidence:\n{}\nAllowed paths:\n{}\nRecommended commands:\n{}\nPlan summary:\n{}",
        context.requested_scope,
        context.visibility_scope,
        yaml_lines(&context.resolved_specs),
        yaml_lines(&context.recent_evidence),
        yaml_paths(&context.allowed_paths),
        yaml_lines(&context.recommended_commands),
        plan.map(plan_summary).unwrap_or_else(|| "- none".into())
    );
    PromptEnvelope {
        task_kind: "agent_context".into(),
        phase: "context".into(),
        spec_ref: SpecRef {
            module: "agent".into(),
            operation: "context".into(),
        },
        allowed_paths: context.allowed_paths.clone(),
        prompt,
    }
}

pub fn parse_skeleton_projection_response(raw: &str) -> Result<SkeletonProjectionResponse, String> {
    serde_json::from_str(raw).map_err(|err| format!("invalid skeleton projection response: {err}"))
}

pub fn parse_module_batch_response(raw: &str) -> Result<ModuleBatchCodegenResponse, String> {
    serde_json::from_str(raw).map_err(|err| format!("invalid module batch response: {err}"))
}

fn operation_block(operation: &OperationContract) -> String {
    format!(
        "- id: {}\n  operation: {}\n  purpose: {}\n  depends_on:\n{}\n  rely:\n{}\n  guarantee:\n{}\n  preconditions:\n{}\n  postconditions:\n{}\n  invariants_preserved:\n{}\n  failure_semantics:\n{}\n  security:\n{}\n  test_obligations:\n{}\n  editable_region:\n    file: {}\n    start_marker: {}\n    end_marker: {}",
        operation.id,
        operation.operation,
        operation.purpose,
        serde_yaml::to_string(&operation.depends_on).unwrap_or_default(),
        serde_yaml::to_string(&operation.rely).unwrap_or_default(),
        serde_yaml::to_string(&operation.guarantee).unwrap_or_default(),
        yaml_lines(&operation.preconditions),
        yaml_lines(&operation.postconditions),
        yaml_lines(&operation.invariants_preserved),
        serde_yaml::to_string(&operation.failure_semantics).unwrap_or_default(),
        serde_yaml::to_string(&operation.security).unwrap_or_default(),
        serde_yaml::to_string(&operation.test_obligations).unwrap_or_default(),
        operation.llm_codegen.editable_region.file.display(),
        operation.llm_codegen.editable_region.start_marker,
        operation.llm_codegen.editable_region.end_marker,
    )
}

fn toolchain_summary(toolchain: Option<&ToolchainSpecBundle>) -> String {
    toolchain
        .map(|item| {
            format!(
                "target_arch: {}\ntarget_triple: {}\nlinker: {}\nentry_symbol: {}\noutput_artifacts:\n{}",
                item.toolchain.target_arch,
                item.toolchain.target_triple,
                item.toolchain.linker,
                item.link.entry_symbol,
                yaml_paths(&item.build.generated_artifacts),
            )
        })
        .unwrap_or_else(|| "none".into())
}

fn allowed_paths_from_spec(normalized: &NormalizedSpecBundle, project_root: &Path) -> Vec<PathBuf> {
    let mut paths = normalized
        .operations
        .iter()
        .map(|op| project_root.join(&op.llm_codegen.editable_region.file))
        .collect::<Vec<_>>();
    paths.extend(
        normalized
            .architecture
            .toolchain
            .build
            .sources
            .iter()
            .map(|path| project_root.join(path)),
    );
    paths.extend(
        normalized
            .architecture
            .toolchain
            .build
            .include_paths
            .iter()
            .map(|path| project_root.join(path)),
    );
    paths.push(project_root.join(&normalized.architecture.toolchain.link.linker_script));
    if let Some(gdb_script) = &normalized.architecture.toolchain.debug.gdb_script {
        paths.push(project_root.join(gdb_script));
    }
    paths.sort();
    paths.dedup();
    paths
}

fn yaml_lines(items: &[String]) -> String {
    if items.is_empty() {
        return "- none".into();
    }
    items
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn yaml_paths(items: &[PathBuf]) -> String {
    if items.is_empty() {
        return "- none".into();
    }
    items
        .iter()
        .map(|item| format!("- {}", item.display()))
        .collect::<Vec<_>>()
        .join("\n")
}

fn plan_summary(plan: &PlanDraft) -> String {
    format!(
        "task: {}\nrelated_specs:\n{}\nrequired_validations:\n{}\ngeneration_waves:\n{}",
        plan.task,
        yaml_lines(&plan.related_specs),
        yaml_lines(&plan.required_validations),
        plan.generation_waves
            .iter()
            .map(|wave| format!("- {}", wave.join(", ")))
            .collect::<Vec<_>>()
            .join("\n")
    )
}
