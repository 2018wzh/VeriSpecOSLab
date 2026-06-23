import type { CliCommand } from "./types.ts";
import { CliError } from "./errors.ts";
import * as handlers from "./commands/index.ts";
import type { CommandOutcome, ExecContext } from "./bootstrap.ts";

export async function executeCommand(command: CliCommand, context: ExecContext): Promise<CommandOutcome> {
  const { projectRoot, evidence } = context;

  switch (command.kind) {
    case "login":
      return handlers.executeLogin(command, context);

    case "logout":
      return handlers.executeLogout(command, projectRoot);

    case "whoami":
      return handlers.executeWhoami(command, projectRoot, context);

    case "init":
      return handlers.executeInit(command, context);

    case "doctor":
      return handlers.executeDoctor(command);

    case "stage_show":
      return handlers.executeStageShow(command, projectRoot);

    case "toolchain_lint":
      return handlers.executeToolchainLint(command, projectRoot);

    case "spec_lint":
      return handlers.executeSpecLint(command, projectRoot, context, evidence);

    case "spec_normalize":
      return handlers.executeSpecNormalize(command, projectRoot, context, evidence);

    case "spec_check_consistency":
      return handlers.executeSpecCheckConsistency(command, projectRoot, context, evidence);

    case "spec_patch_lint":
      return handlers.executeSpecPatchLint(command, projectRoot, context, evidence);

    case "spec_patch_apply":
      return handlers.executeSpecPatchApply(command, projectRoot, context, evidence);

    case "arch_lint":
      return handlers.executeArchLint(command, projectRoot, context, evidence);

    case "arch_compose":
      return handlers.executeArchCompose(command, projectRoot, context, evidence);

    case "arch_derive_tests":
      return handlers.executeArchDeriveTests(command, projectRoot, context, evidence);

    case "build":
      return handlers.executeBuild(command, context, evidence, projectRoot);

    case "build_generate":
      return handlers.executeBuildGenerate(command, context, evidence);

    case "run_qemu":
      return handlers.executeRunQemu(command, context, evidence, projectRoot);

    case "test":
      return handlers.executeTest(command, context, evidence, projectRoot);

    case "verify":
      return handlers.executeVerify(command, context, evidence);

    case "trace_syscall":
      return handlers.executeTraceSyscall(command, context, evidence, projectRoot);

    case "debug_explain_log":
      return handlers.executeDebugExplainLog(command, projectRoot);

    case "report_generate":
      return handlers.executeReportGenerate(command, context);

    case "submit_pack":
      return handlers.executeSubmitPack(command, projectRoot, evidence);

    case "ledger_record":
      return handlers.executeLedgerRecord(command, projectRoot, evidence);

    case "kb_add":
      return handlers.executeKbAdd(command, projectRoot, evidence);

    case "kb_list":
      return handlers.executeKbList(projectRoot);

    case "kb_search":
      return handlers.executeKbSearch(command, projectRoot);

    case "kb_remove":
      return handlers.executeKbRemove(command, projectRoot);

    case "kb_clear":
      return handlers.executeKbClear(projectRoot);

    case "kb_export_manifest":
      return handlers.executeKbExportManifest(command, projectRoot, evidence);

    case "kb_import_manifest":
      return handlers.executeKbImportManifest(command, projectRoot, evidence);

    case "agent_serve":
      return handlers.executeAgentServe(command, projectRoot, evidence);

    case "agent_context":
      return handlers.executeAgentContext(command, projectRoot, context);

    case "agent_plan":
      return handlers.executeAgentPlan(command, context, evidence);

    case "agent_generate":
      return handlers.executeAgentGenerate(command, context, evidence);

    case "agent_apply_patch":
      return handlers.executeAgentApplyPatch(command, projectRoot, evidence, context.effectivePolicy);

    case "agent_validate_generated":
      return handlers.executeAgentValidateGenerated(command, context, evidence);

    case "agent_debug":
      return handlers.executeAgentDebug(command, context, evidence);

    case "agent_log":
      return handlers.executeAgentLog(command, projectRoot, evidence);

    case "agent_review_spec":
      return handlers.executeAgentReviewSpec(command, context, evidence);

    case "agent_ask":
      return handlers.executeAgentAsk(command, context, evidence);

    default:
      throw new CliError(`unsupported command: ${JSON.stringify(command)}`, "failed");
  }
}
