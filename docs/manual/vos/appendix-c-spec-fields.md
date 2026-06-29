# 附录 C：Spec YAML 字段快速索引

按 YAML 文件类型列出核心字段，详细说明见 [05](./05-spec-schema-arch-module-op.md) 和 [06](./06-spec-schema-toolchain-verify-evolution.md)。

## ArchitectureSeed

`id` `project` `domain` `target_platform` `architecture_name` `architecture_summary` `reference_systems` `goals` `non_goals` `constraints` `initial_validation_binding`

## ArchitectureSlice

`id` `stage` `title` `summary` `depends_on_slices` `depends_on_adrs` `mechanisms` `affected_modules` `new_operations` `removed_or_replaced_mechanisms` `invariants` `security_boundaries` `concurrency_highlights` `validation_binding` `open_questions`

## ADR

`id` `date` `status` `decision` `context` `alternatives` `tradeoffs` `affected_specs` `verification_impact`

## ModuleSpec

`id` `module` `stage` `purpose` `related_slices` `related_adrs` `owned_state` `exported_interfaces` `imported_interfaces` `module_invariants` `error_model` `resource_lifetime_rules` `security_boundary` `test_surfaces`

## ConcurrencySpec

`module` `shared_state` `lock_types` `lock_order` `atomic_sections` `interrupt_rules` `wait_wakeup_rules` `rely` `guarantee` `forbidden_patterns`

## OperationContract

`id` `module` `operation` `stage` `purpose` `related_slice` `related_adr` `depends_on` `rely` `guarantee` `preconditions` `postconditions` `invariants_preserved` `failure_semantics` `concurrency` `security` `observability` `test_obligations` `codegen`

### OperationContract 子结构

- **depends_on**：`requires_modules` `requires_ops`
- **rely**：`state_assumptions` `callable_interfaces` `resource_assumptions` `lock_assumptions`
- **guarantee**：`returns` `state_updates` `side_effects` `emitted_events`
- **concurrency**：`atomicity` `lock_order` `interrupt_state` `wait_wakeup_rules`
- **security**：`authority_check` `isolation_boundary` `user_pointer_policy`
- **observability**：`traces` `counters` `expected_logs`
- **test_obligations**：`public` `generated` `hidden_tags`
- **codegen**：`targets` `forbidden_changes` `required_followup_checks`

## CompositionSpec

`id` `title` `related_slices` `affected_modules` `cross_component_rules`

## GoalValidationContract

`goal_id` `category` `summary` `baseline` `target` `correctness_guard` `benchmark_or_oracle` `negative_tradeoff_checks` `evidence_required`

## SpecPatch

`id` `stage` `title` `reason` `kind` `commit_sha` `parent_sha` `spec_commit_sha` `affected_specs` `affected_modules` `affected_operations` `before` `after` `risks` `required_regressions` `approval_notes`

## ToolchainProfile

- `toolchain`：`target_arch` `target_triple` `c_compiler` `asm_compiler` `linker` `archiver`
- `environment`：`required_tools` `allowed_versions` `disallowed_tools`

## BuildContract

`build`：`allowed_output_path` `sources` `include_paths` `cflags` `asmflags` `ldflags` `features` `variants` `forbidden_flags` `generated_artifacts` `phases`

## LinkContract

`link`：`linker_script` `entry_symbol` `section_rules` `relocation_model` `abi_constraints`

## ImageContract

`image`：`output_kind` `objcopy_rules` `boot_chain` `required_artifacts`

## RunContract

`run`：`emulator` `machine` `cpu` `memory` `bios` `kernel_arg` `success_signal` `timeout_secs` `extra_args` `profiles` `cases`

## DebugContract

`debug`：`symbols_required` `gdb_script` `trace_points`

## PublicMatrix

`stage` `public_requirements[]`（每项含 `id` `description` `related_specs` `required_tests` `required_artifacts`）

## EvidenceSchema

`evidence_item`：`id` `kind` `producer` `related_specs` `pass_condition` `artifact_paths`
