use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use vos_core::{ArchitectureSlice, ModuleGenerationJob, Result, VosError};

use crate::hierarchy::expand_module_reference;

pub(crate) fn module_dependencies(
    operations: &[vos_core::OperationContract],
    active_modules: &BTreeSet<String>,
    active_executable_modules: &BTreeSet<String>,
    module: &str,
) -> Vec<String> {
    let mut deps = BTreeSet::new();
    for operation in operations.iter().filter(|op| op.module == module) {
        for reference in &operation.depends_on.requires_modules {
            for dependency in
                expand_module_reference(reference, active_modules, active_executable_modules, true)
            {
                if dependency != module {
                    deps.insert(dependency);
                }
            }
        }
    }
    deps.into_iter().collect()
}

pub(crate) fn build_module_waves(jobs: &[ModuleGenerationJob]) -> Result<Vec<Vec<String>>> {
    let mut remaining = jobs
        .iter()
        .map(|job| (job.module.clone(), job.depends_on_modules.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut resolved = BTreeSet::new();
    let mut waves = Vec::new();
    while !remaining.is_empty() {
        let wave = remaining
            .iter()
            .filter(|(_, deps)| deps.iter().all(|dep| resolved.contains(dep)))
            .map(|(module, _)| module.clone())
            .collect::<Vec<_>>();
        if wave.is_empty() {
            return Err(VosError::Message(
                "module dependency graph contains a cycle".into(),
            ));
        }
        for module in &wave {
            remaining.remove(module);
            resolved.insert(module.clone());
        }
        waves.push(wave);
    }
    Ok(waves)
}

pub(crate) fn slices_until_stage<'a>(
    slices: &'a [ArchitectureSlice],
    target_stage: &str,
) -> Result<Vec<&'a ArchitectureSlice>> {
    let mut selected = Vec::new();
    let mut target_index = None;
    for (index, slice) in slices.iter().enumerate() {
        selected.push(slice);
        if slice.stage == target_stage {
            target_index = Some(index);
            break;
        }
    }
    if target_index.is_none() {
        return Err(VosError::Message(format!(
            "target stage not found: {target_stage}"
        )));
    }
    Ok(selected)
}

pub(crate) fn validate_slice_dependency_graph(slices: &[ArchitectureSlice]) -> Result<()> {
    let graph = slices
        .iter()
        .map(|slice| (slice.id.clone(), slice.depends_on_slices.clone()))
        .collect::<HashMap<_, _>>();
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    for node in graph.keys() {
        visit_slice(node, &graph, &mut visiting, &mut visited)?;
    }
    Ok(())
}

fn visit_slice(
    node: &str,
    graph: &HashMap<String, Vec<String>>,
    visiting: &mut HashSet<String>,
    visited: &mut HashSet<String>,
) -> Result<()> {
    if visited.contains(node) {
        return Ok(());
    }
    if !visiting.insert(node.to_string()) {
        return Err(VosError::Message(format!(
            "slice dependency cycle detected at `{node}`"
        )));
    }
    if let Some(edges) = graph.get(node) {
        for edge in edges {
            if graph.contains_key(edge) {
                visit_slice(edge, graph, visiting, visited)?;
            }
        }
    }
    visiting.remove(node);
    visited.insert(node.to_string());
    Ok(())
}
