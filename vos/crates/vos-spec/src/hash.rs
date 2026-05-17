use std::collections::BTreeSet;
use std::hash::{Hash, Hasher};

pub(crate) fn unique_strings(items: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut unique = Vec::new();
    for item in items {
        if seen.insert(item.clone()) {
            unique.push(item.clone());
        }
    }
    unique
}

pub(crate) fn stable_hash(content: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}
