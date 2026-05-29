use crate::compose::compose_architecture;
use crate::hash::unique_strings;
use crate::normalize::load_normalized_spec_bundle;

use std::path::Path;

use vos_core::DerivedTestMatrix;
use vos_core::Result;

pub fn derive_tests(
    project_root: &Path,
    spec_root: &Path,
    target_stage: &str,
) -> Result<DerivedTestMatrix> {
    let normalized = load_normalized_spec_bundle(project_root, spec_root)?;
    let compose = compose_architecture(project_root, spec_root, target_stage)?;
    let enabled_modules = compose
        .enabled_modules
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    let operations = normalized
        .operations
        .iter()
        .filter(|op| enabled_modules.contains(&op.module))
        .collect::<Vec<_>>();
    let public_checks = unique_strings(
        &operations
            .iter()
            .flat_map(|op| op.test_obligations.public.clone())
            .chain(
                normalized
                    .architecture
                    .toolchain
                    .validation
                    .must_pass
                    .clone(),
            )
            .collect::<Vec<_>>(),
    );
    let generated_checks = unique_strings(
        &operations
            .iter()
            .flat_map(|op| op.test_obligations.generated.clone())
            .collect::<Vec<_>>(),
    );
    Ok(vos_core::DerivedTestMatrix {
        stage: target_stage.to_string(),
        public_checks,
        generated_checks,
        build_checks: vec!["build_kernel".into()],
        run_checks: vec!["qemu_boot_smoke".into()],
    })
}
