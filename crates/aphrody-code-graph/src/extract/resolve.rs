// SPDX-License-Identifier: Apache-2.0
//! Corpus assembly: merge per-file extractions, resolve imports and call sites, and fold
//! sourceless type stubs onto their unique definition.
//!
//! Call resolution never links a call to an arbitrary homonym of another package:
//! - a call to a name defined in the same file resolves there (EXTRACTED);
//! - a Rust call carrying a path (`use` alias, `crate::m::f()`, `bun_sys::open()`, `Type::f()`,
//!   `x.f()` on a receiver of known type) resolves inside the named crate, module or type
//!   (INFERRED);
//! - a plain Rust call resolves to a unique definition of the same crate, then of a glob import;
//! - a JS/TS call to an imported name resolves inside the module its specifier names
//!   (EXTRACTED for a relative specifier); a built-in or package specifier is external;
//! - a plain JS/TS call resolves only to an ambient `.d.ts` declaration.

use std::collections::{BTreeMap, HashMap, HashSet};

use super::{
    FileExtract, ImportKind, NodeClass, RawCall, RawEdge, RawImport,
    ids::{file_stem, make_id},
    rust::{is_blocklisted, strip_generics},
};
use crate::graph::{Confidence, Edge, Graph, Node, NodeKind};

/// Counters describing an assembly.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AssembleStats {
    /// Call sites seen.
    pub calls: usize,
    /// Resolved inside the same file.
    pub same_file: usize,
    /// Resolved to a definition in another file.
    pub cross_file: usize,
    /// Calls into an external module (Node/Bun built-ins, npm packages).
    #[serde(default)]
    pub external: usize,
    /// Left unresolved (unknown, ambiguous or too generic).
    pub unresolved: usize,
    /// Stubs folded onto a definition.
    pub stubs_folded: usize,
    /// JS/TS imports and Markdown links resolved to a file of the corpus.
    #[serde(default)]
    pub imports_resolved: usize,
    /// JS/TS imports of an external module.
    #[serde(default)]
    pub imports_external: usize,
}

/// Corpus facts the per-file extractions cannot know.
#[derive(Debug, Clone, Default)]
pub struct AssembleContext {
    /// Package of each file: the Rust crate identifier (`bun_sys`) or the npm package name.
    pub package_of: HashMap<String, String>,
    /// Directory of each package manifest, relative to the root (`src/sys`), so a Rust file's
    /// module path is known (`src/sys/lib.rs` is the crate root, `src/sys/fd.rs` is `fd`).
    pub package_dir: HashMap<String, String>,
}

fn lang_of(file: &str) -> Option<String> {
    Some(
        match file.rsplit_once('.')?.1 {
            "rs" => "rust",
            "ts" | "tsx" | "mts" | "cts" => "typescript",
            "js" | "jsx" | "mjs" | "cjs" => "javascript",
            "py" | "pyw" | "pyi" => "python",
            "md" | "mdx" => "markdown",
            _ => return None,
        }
        .to_owned(),
    )
}

/// File nodes whose bare name is shared by several files get the shortest path suffix (at
/// least two components) that is unique among them, as Graphify labels them.
fn disambiguate_file_labels(nodes: &mut [Node]) {
    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, n) in nodes.iter().enumerate() {
        if let Some(file) = &n.file
            && n.id == make_id(&[file])
            && n.loc.as_deref() == Some("L1")
            && file.rsplit('/').next() == Some(n.label.as_str())
        {
            groups.entry(n.label.clone()).or_default().push(i);
        }
    }
    for members in groups.into_values().filter(|m| m.len() > 1) {
        let paths: Vec<Vec<&str>> = members
            .iter()
            .map(|&i| nodes[i].file.as_deref().unwrap_or("").split('/').collect())
            .collect();
        let suffix =
            |parts: &Vec<&str>, depth: usize| parts[parts.len().saturating_sub(depth)..].join("/");
        let labels: Vec<String> = paths
            .iter()
            .map(|parts| {
                for depth in 2..=parts.len() {
                    let candidate = suffix(parts, depth);
                    if paths
                        .iter()
                        .filter(|other| suffix(other, depth) == candidate)
                        .count()
                        == 1
                    {
                        return candidate;
                    }
                }
                parts.join("/")
            })
            .collect();
        for (&i, label) in members.iter().zip(labels) {
            nodes[i].label = label;
        }
    }
}

/// A callable definition.
struct Def {
    id: String,
    file: String,
    method: bool,
    /// Base name of the owning type for a method.
    owner: Option<String>,
}

const NODE_BUILTINS: &[&str] = &[
    "assert",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "http2",
    "https",
    "inspector",
    "module",
    "net",
    "os",
    "path",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "stream",
    "string_decoder",
    "sys",
    "timers",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
];

const JS_EXTENSIONS: &[&str] = &[
    ".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
];

fn is_builtin_module(spec: &str) -> bool {
    if spec.starts_with("node:") || spec.starts_with("bun:") || spec == "bun" {
        return true;
    }
    NODE_BUILTINS.contains(&spec)
        || spec.split_once('/').is_some_and(|(head, _)| {
            NODE_BUILTINS.contains(&head)
                && matches!(
                    head,
                    "fs" | "stream"
                        | "util"
                        | "path"
                        | "dns"
                        | "timers"
                        | "assert"
                        | "readline"
                        | "inspector"
                )
        })
}

fn parent_dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

/// `a/b` + `../c/./d` gives `a/c/d`; `None` when it escapes the root.
fn join_relative(dir: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p => parts.push(p),
        }
    }
    Some(parts.join("/"))
}

/// Where an import specifier points.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Target {
    /// A file of the corpus; `true` when found through a relative specifier.
    File(String, bool),
    /// A built-in or package module.
    External,
}

fn module_stem(path: &str) -> &str {
    path.strip_suffix(".d.ts")
        .unwrap_or_else(|| path.rsplit_once('.').map_or(path, |(s, _)| s))
}

struct Files {
    all: HashSet<String>,
    /// Lower-case file name without extension to paths.
    by_stem: HashMap<String, Vec<String>>,
    cache: HashMap<(String, String), Option<Target>>,
}

impl Files {
    fn new(paths: impl Iterator<Item = String>) -> Self {
        let all: HashSet<String> = paths.collect();
        let mut by_stem: HashMap<String, Vec<String>> = HashMap::new();
        for p in &all {
            let name = p.rsplit('/').next().unwrap_or(p);
            by_stem
                .entry(module_stem(name).to_lowercase())
                .or_default()
                .push(p.clone());
        }
        for v in by_stem.values_mut() {
            v.sort();
        }
        Self {
            all,
            by_stem,
            cache: HashMap::new(),
        }
    }

    fn probe(&self, base: &str) -> Option<String> {
        if self.all.contains(base) {
            return Some(base.to_owned());
        }
        let stripped = [".js", ".mjs", ".cjs", ".jsx"]
            .iter()
            .find_map(|e| base.strip_suffix(e))
            .unwrap_or(base);
        for root in [base, stripped] {
            for ext in JS_EXTENSIONS {
                let candidate = format!("{root}{ext}");
                if self.all.contains(&candidate) {
                    return Some(candidate);
                }
            }
            for ext in JS_EXTENSIONS {
                let candidate = format!("{root}/index{ext}");
                if self.all.contains(&candidate) {
                    return Some(candidate);
                }
            }
        }
        None
    }

    fn module(&mut self, importer: &str, spec: &str) -> Option<Target> {
        let key = (parent_dir(importer).to_owned(), spec.to_owned());
        if let Some(hit) = self.cache.get(&key) {
            return hit.clone();
        }
        let relative =
            spec.starts_with("./") || spec.starts_with("../") || matches!(spec, "." | "..");
        let found = if relative {
            join_relative(parent_dir(importer), spec)
                .and_then(|base| self.probe(&base))
                .map(|p| Target::File(p, true))
        } else if is_builtin_module(spec) {
            Some(Target::External)
        } else if spec.contains('/') && !spec.starts_with('@') {
            // Path aliases such as Bun's `internal/fs/streams`: a unique file ending with it.
            let suffix = format!("/{spec}");
            let index = format!("{suffix}/index");
            let mut hits: Vec<&String> = self
                .all
                .iter()
                .filter(|p| !p.contains("node_modules/"))
                .filter(|p| {
                    let stem = module_stem(p);
                    stem.ends_with(&suffix) || stem.ends_with(&index)
                })
                .collect();
            hits.sort();
            hits.dedup();
            match hits.as_slice() {
                [only] => Some(Target::File((*only).clone(), false)),
                _ => Some(Target::External),
            }
        } else {
            // A bare name: a unique first-party file of that name (a `paths` alias such as
            // `harness`), otherwise an npm package.
            match self.by_stem.get(&spec.to_lowercase()).map(Vec::as_slice) {
                Some([only]) if !only.contains("node_modules/") => {
                    Some(Target::File(only.clone(), false))
                }
                _ => Some(Target::External),
            }
        };
        self.cache.insert(key, found.clone());
        found
    }

    fn markdown(&self, importer: &str, import: &RawImport) -> Option<(String, Confidence)> {
        match import.kind {
            ImportKind::Link => {
                let path = join_relative(parent_dir(importer), &import.specifier)?;
                self.all
                    .contains(&path)
                    .then_some((path, Confidence::Extracted))
            }
            ImportKind::Wiki => {
                let wanted = import.specifier.trim_end_matches(".md").to_lowercase();
                let candidates = self.by_stem.get(&wanted)?;
                let md: Vec<&String> = candidates
                    .iter()
                    .filter(|p| p.ends_with(".md") || p.ends_with(".mdx"))
                    .collect();
                let near: Vec<&&String> = md
                    .iter()
                    .filter(|p| parent_dir(p) == parent_dir(importer))
                    .collect();
                match (near.as_slice(), md.as_slice()) {
                    ([only], _) => Some(((**only).clone(), Confidence::Inferred)),
                    ([], [only]) => Some(((*only).clone(), Confidence::Inferred)),
                    _ => None,
                }
            }
            ImportKind::Module => None,
        }
    }
}

/// Module path segments of a Rust file inside its crate directory `dir` (`fs/mod.rs` gives
/// `["fs"]`, `lib.rs` gives `[]`); without a known directory, every path segment counts.
fn module_segments<'f>(file: &'f str, dir: Option<&str>) -> Vec<&'f str> {
    let inside = dir
        .filter(|d| !d.is_empty())
        .and_then(|d| file.strip_prefix(d).and_then(|rest| rest.strip_prefix('/')))
        .unwrap_or(file);
    let inside = inside.strip_prefix("src/").unwrap_or(inside);
    let mut segs: Vec<&str> = inside
        .strip_suffix(".rs")
        .unwrap_or(inside)
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    if segs
        .last()
        .is_some_and(|last| matches!(*last, "lib" | "main" | "mod"))
    {
        segs.pop();
    }
    if dir.is_none() {
        segs.retain(|s| *s != "src");
    }
    segs
}

/// How well a definition file matches the module path of a call: the crate root for a bare
/// `krate::f()`, a file whose module path ends with (or contains) the named modules otherwise.
fn module_score(file: &str, dir: Option<&str>, modules: &[&str]) -> usize {
    let segs = module_segments(file, dir);
    if modules.is_empty() {
        return if dir.is_some() && segs.is_empty() {
            3
        } else {
            1
        };
    }
    if segs.ends_with(modules) {
        3
    } else if modules.iter().all(|m| segs.contains(m)) {
        2
    } else {
        0
    }
}

struct Resolver<'a> {
    defs: HashMap<String, Vec<Def>>,
    package_of: &'a HashMap<String, String>,
    package_dir: &'a HashMap<String, String>,
    crates: HashSet<String>,
    globs: HashMap<String, Vec<String>>,
}

impl Resolver<'_> {
    fn package(&self, file: &str) -> &str {
        self.package_of.get(file).map_or("", String::as_str)
    }

    /// The best of `candidates` by module match; a tie leaves the call unresolved.
    fn best<'d>(&self, candidates: &[&'d Def], modules: &[&str]) -> Option<&'d Def> {
        let scored: Vec<(usize, &Def)> = candidates
            .iter()
            .map(|d| {
                let dir = self
                    .package_dir
                    .get(self.package(&d.file))
                    .map(String::as_str);
                (module_score(&d.file, dir, modules), *d)
            })
            .filter(|(s, _)| *s > 0)
            .collect();
        let top = scored.iter().map(|(s, _)| *s).max()?;
        let winners: Vec<&Def> = scored
            .into_iter()
            .filter(|(s, _)| *s == top)
            .map(|(_, d)| d)
            .collect();
        if let [only] = winners.as_slice() {
            Some(*only)
        } else {
            None
        }
    }

    /// Resolve a Rust call that carries a path.
    fn rust_path(&self, call: &RawCall, path: &str) -> Option<(String, f64)> {
        let own = self.package(&call.file);
        let segs: Vec<&str> = path.split("::").filter(|s| !s.is_empty()).collect();
        let mut i = 0;
        while i < segs.len() && matches!(segs[i], "crate" | "self" | "super") {
            i += 1;
        }
        let mut krate = own;
        if i == 0 && !segs.is_empty() && self.crates.contains(segs[0]) {
            krate = segs[0];
            i = 1;
        }
        let rest = &segs[i..];
        let (modules, ty) = match rest.split_last() {
            Some((last, before)) if last.starts_with(char::is_uppercase) => (before, Some(*last)),
            _ => (rest, None),
        };
        let all = self.defs.get(&call.name)?;
        if let Some(ty) = ty {
            let typed: Vec<&Def> = all
                .iter()
                .filter(|d| d.owner.as_deref() == Some(ty))
                .collect();
            let in_crate: Vec<&Def> = typed
                .iter()
                .copied()
                .filter(|d| self.package(&d.file) == krate)
                .collect();
            if let Some(d) = self.best(&in_crate, modules) {
                return Some((d.id.clone(), 0.9));
            }
            if in_crate.is_empty()
                && let [only] = typed.as_slice()
            {
                // A re-exported type: the only type of that name in the corpus with this method.
                return Some((only.id.clone(), 0.7));
            }
            return None;
        }
        let free: Vec<&Def> = all
            .iter()
            .filter(|d| !d.method && self.package(&d.file) == krate)
            .collect();
        self.best(&free, modules)
            .map(|d| (d.id.clone(), if modules.is_empty() { 0.8 } else { 0.9 }))
    }

    /// Resolve a plain Rust call that matched nothing in its file: same crate, then globs.
    fn rust_plain(&self, call: &RawCall) -> Option<(String, f64)> {
        let own = self.package(&call.file);
        let all = self.defs.get(&call.name)?;
        let local: Vec<&Def> = all
            .iter()
            .filter(|d| !d.method && self.package(&d.file) == own)
            .collect();
        if let [only] = local.as_slice() {
            return Some((only.id.clone(), 0.8));
        }
        for glob in self.globs.get(&call.file).into_iter().flatten() {
            if let Some((id, _)) = self.rust_path(call, glob) {
                return Some((id, 0.7));
            }
        }
        None
    }
}

/// Assemble a graph from per-file extractions, without package information (every file is
/// treated as part of one package).
#[must_use]
pub fn assemble(files: Vec<FileExtract>) -> (Graph, AssembleStats) {
    assemble_with(files, &AssembleContext::default())
}

/// Assemble a graph from per-file extractions.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn assemble_with(files: Vec<FileExtract>, context: &AssembleContext) -> (Graph, AssembleStats) {
    let mut stats = AssembleStats::default();
    // 1. Merge nodes: a sourced definition replaces a stub with the same id.
    let mut nodes: BTreeMap<String, super::RawNode> = BTreeMap::new();
    let mut edges: Vec<RawEdge> = Vec::new();
    let mut calls = Vec::new();
    let mut imports: Vec<(String, RawImport)> = Vec::new();
    let mut globs: HashMap<String, Vec<String>> = HashMap::new();
    for f in files {
        let file = f
            .nodes
            .iter()
            .find(|n| n.class == NodeClass::File)
            .map(|n| n.file.clone());
        for n in f.nodes {
            match nodes.get_mut(&n.id) {
                Some(existing) if existing.file.is_empty() && n.file.is_empty() => {
                    // Two stubs of one id: keep the proper-case label (`Json` over `json`).
                    if existing.label == existing.id && n.label != n.id {
                        existing.label = n.label;
                    }
                }
                Some(existing) if !existing.file.is_empty() || n.file.is_empty() => {}
                _ => {
                    nodes.insert(n.id.clone(), n);
                }
            }
        }
        edges.extend(f.edges);
        calls.extend(f.calls);
        if let Some(file) = file {
            imports.extend(f.imports.into_iter().map(|i| (file.clone(), i)));
            if !f.globs.is_empty() {
                globs.insert(file, f.globs);
            }
        }
    }

    // 2. Fold sourceless stubs onto a unique sourced node of the same label (types only).
    let mut by_label: HashMap<String, Vec<String>> = HashMap::new();
    for n in nodes
        .values()
        .filter(|n| matches!(n.class, NodeClass::Type | NodeClass::Variant))
    {
        by_label
            .entry(n.label.to_lowercase())
            .or_default()
            .push(n.id.clone());
    }
    let mut rewire: HashMap<String, String> = HashMap::new();
    for n in nodes.values().filter(|n| n.file.is_empty()) {
        if let Some(candidates) = by_label.get(&n.label.to_lowercase())
            && let [only] = candidates.as_slice()
        {
            rewire.insert(n.id.clone(), only.clone());
        }
    }
    stats.stubs_folded = rewire.len();
    for e in &mut edges {
        if let Some(t) = rewire.get(&e.dst) {
            e.dst.clone_from(t);
        }
    }
    for id in rewire.keys() {
        nodes.remove(id);
    }

    // 2b. Rust import targets: a unique type with that name, else a unique file with that stem,
    // else a concept node labelled by the imported name.
    let mut by_stem: HashMap<String, Vec<String>> = HashMap::new();
    for n in nodes.values().filter(|n| n.class == NodeClass::File) {
        let stem = file_stem(n.file.rsplit('/').next().unwrap_or(&n.file));
        by_stem
            .entry(stem.to_lowercase())
            .or_default()
            .push(n.id.clone());
    }
    let mut import_targets: HashMap<String, String> = HashMap::new();
    let mut concepts: Vec<String> = Vec::new();
    for e in edges
        .iter()
        .filter(|e| e.relation == "imports_from" && !nodes.contains_key(&e.dst))
    {
        if import_targets.contains_key(&e.dst) {
            continue;
        }
        let resolved = match (
            by_label.get(&e.dst).map(Vec::as_slice),
            by_stem.get(&e.dst).map(Vec::as_slice),
        ) {
            (Some([only]), _) | (None | Some([]), Some([only])) => only.clone(),
            _ => {
                concepts.push(e.dst.clone());
                e.dst.clone()
            }
        };
        import_targets.insert(e.dst.clone(), resolved);
    }
    for e in &mut edges {
        if e.relation == "imports_from"
            && let Some(t) = import_targets.get(&e.dst)
        {
            e.dst.clone_from(t);
        }
    }
    for id in concepts {
        nodes.entry(id.clone()).or_insert(super::RawNode {
            id: id.clone(),
            label: id,
            file: String::new(),
            loc: String::new(),
            class: NodeClass::Stub,
        });
    }
    stats.stubs_folded += import_targets.len();

    // 3. JS/TS imports and Markdown links.
    let mut file_index = Files::new(
        nodes
            .values()
            .filter(|n| n.class == NodeClass::File)
            .map(|n| n.file.clone()),
    );
    let mut symbols_by_file: HashMap<(String, String), String> = HashMap::new();
    for n in nodes
        .values()
        .filter(|n| !n.file.is_empty() && n.class != NodeClass::File)
    {
        if !n.label.starts_with('.') {
            let bare = n.label.trim_end_matches("()").to_owned();
            symbols_by_file
                .entry((n.file.clone(), bare))
                .or_insert_with(|| n.id.clone());
        }
    }
    let mut module_of: HashMap<(String, String), Option<Target>> = HashMap::new();
    for (file, import) in &imports {
        let from = make_id(&[file]);
        if import.kind != ImportKind::Module {
            if let Some((target, confidence)) = file_index.markdown(file, import) {
                stats.imports_resolved += 1;
                edges.push(RawEdge {
                    src: from,
                    dst: make_id(&[&target]),
                    relation: "references".into(),
                    confidence,
                    score: if confidence == Confidence::Extracted {
                        1.0
                    } else {
                        0.9
                    },
                    file: file.clone(),
                    loc: import.loc.clone(),
                    context: Some("link".into()),
                });
            }
            continue;
        }
        let target = file_index.module(file, &import.specifier);
        module_of.insert((file.clone(), import.specifier.clone()), target.clone());
        match target {
            Some(Target::File(path, relative)) => {
                stats.imports_resolved += 1;
                let (confidence, score) = if relative {
                    (Confidence::Extracted, 1.0)
                } else {
                    (Confidence::Inferred, 0.85)
                };
                edges.push(RawEdge {
                    src: from.clone(),
                    dst: make_id(&[&path]),
                    relation: "imports_from".into(),
                    confidence,
                    score,
                    file: file.clone(),
                    loc: import.loc.clone(),
                    context: Some("import".into()),
                });
                for name in &import.names {
                    if let Some(symbol) = symbols_by_file.get(&(path.clone(), name.clone())) {
                        edges.push(RawEdge {
                            src: from.clone(),
                            dst: symbol.clone(),
                            relation: "imports".into(),
                            confidence,
                            score,
                            file: file.clone(),
                            loc: import.loc.clone(),
                            context: Some("import".into()),
                        });
                    }
                }
            }
            Some(Target::External) => stats.imports_external += 1,
            None => {}
        }
    }

    // 4. Resolve call sites.
    let mut owner_of: HashMap<String, String> = HashMap::new();
    for e in edges.iter().filter(|e| e.relation == "method") {
        if let Some(owner) = nodes.get(&e.src) {
            owner_of.insert(e.dst.clone(), strip_generics(&owner.label));
        }
    }
    let mut defs: HashMap<String, Vec<Def>> = HashMap::new();
    for n in nodes.values().filter(|n| !n.file.is_empty()) {
        if let Some(inner) = n.label.strip_suffix("()") {
            let (name, method) = inner
                .strip_prefix('.')
                .map_or((inner, false), |name| (name, true));
            defs.entry(name.to_owned()).or_default().push(Def {
                id: n.id.clone(),
                file: n.file.clone(),
                method,
                owner: if method {
                    owner_of.get(&n.id).cloned()
                } else {
                    None
                },
            });
        }
    }
    let crates: HashSet<String> = context
        .package_of
        .iter()
        .filter(|(file, _)| file.ends_with(".rs"))
        .map(|(_, krate)| krate.clone())
        .collect();
    let resolver = Resolver {
        defs,
        package_of: &context.package_of,
        package_dir: &context.package_dir,
        crates,
        globs,
    };
    let mut seen_calls: HashSet<(String, String)> = HashSet::new();
    for call in calls {
        stats.calls += 1;
        let rust = call.file.ends_with(".rs");
        let same_file = || -> Option<String> {
            let found = resolver.defs.get(&call.name)?;
            let same: Vec<&Def> = found
                .iter()
                .filter(|d| d.file == call.file && (d.method == call.method || !rust))
                .collect();
            if let [only] = same.as_slice() {
                Some(only.id.clone())
            } else {
                None
            }
        };
        let resolved: Option<(String, Confidence, f64)> = if let Some(module) = &call.module {
            match module_of
                .get(&(call.file.clone(), module.clone()))
                .cloned()
                .flatten()
            {
                Some(Target::File(path, relative)) => {
                    resolver.defs.get(&call.name).and_then(|found| {
                        let in_module: Vec<&Def> = found
                            .iter()
                            .filter(|d| d.file == path && !d.method)
                            .collect();
                        match in_module.as_slice() {
                            [only] if relative => {
                                Some((only.id.clone(), Confidence::Extracted, 1.0))
                            }
                            [only] => Some((only.id.clone(), Confidence::Inferred, 0.85)),
                            _ => None,
                        }
                    })
                }
                Some(Target::External) => {
                    stats.external += 1;
                    continue;
                }
                None => None,
            }
        } else if let Some(path) = &call.path {
            resolver
                .rust_path(&call, path)
                .map(|(id, score)| (id, Confidence::Inferred, score))
        } else if let Some(id) = same_file() {
            Some((id, Confidence::Extracted, 0.85))
        } else if call.method {
            None
        } else if rust {
            if is_blocklisted(&call.name) {
                None
            } else {
                resolver
                    .rust_plain(&call)
                    .map(|(id, score)| (id, Confidence::Inferred, score))
            }
        } else {
            // JS/TS: a name neither local nor imported is a global; only an ambient declaration
            // (`declare function` in a `.d.ts`) can define it.
            resolver.defs.get(&call.name).and_then(|found| {
                let ambient: Vec<&Def> = found
                    .iter()
                    .filter(|d| d.file.ends_with(".d.ts") && !d.method)
                    .collect();
                if let [only] = ambient.as_slice() {
                    Some((only.id.clone(), Confidence::Inferred, 0.6))
                } else {
                    None
                }
            })
        };
        let Some((target, confidence, score)) = resolved else {
            stats.unresolved += 1;
            continue;
        };
        if target == call.from || !seen_calls.insert((call.from.clone(), target.clone())) {
            continue;
        }
        let local = resolver
            .defs
            .get(&call.name)
            .is_some_and(|f| f.iter().any(|d| d.id == target && d.file == call.file));
        if local {
            stats.same_file += 1;
        } else {
            stats.cross_file += 1;
        }
        edges.push(RawEdge {
            src: call.from,
            dst: target,
            relation: "calls".into(),
            confidence,
            score,
            file: call.file,
            loc: call.loc,
            context: Some("call".into()),
        });
    }

    // 5. Build the graph; edges to nodes that do not exist are dropped (imports to stubs stay
    // because stubs remain nodes).
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut graph_nodes: Vec<Node> = Vec::new();
    for (id, n) in &nodes {
        index.insert(id.clone(), graph_nodes.len());
        let mut node = Node::code(
            id,
            &n.label,
            if n.file.is_empty() {
                None
            } else {
                Some(&n.file)
            },
        );
        node.lang = lang_of(&n.file);
        node.kind = if n.file.is_empty() {
            NodeKind::Concept
        } else if node.lang.as_deref() == Some("markdown") {
            NodeKind::Document
        } else {
            NodeKind::Code
        };
        node.loc = if n.loc.is_empty() {
            None
        } else {
            Some(n.loc.clone())
        };
        node.package = context.package_of.get(&n.file).cloned();
        graph_nodes.push(node);
    }
    disambiguate_file_labels(&mut graph_nodes);
    let mut graph_edges = Vec::new();
    for e in edges {
        let (Some(&s), Some(&d)) = (index.get(&e.src), index.get(&e.dst)) else {
            continue;
        };
        graph_edges.push(Edge {
            src: s,
            dst: d,
            relation: e.relation,
            confidence: e.confidence,
            score: e.score,
            file: Some(e.file),
            loc: Some(e.loc),
            weight: 1.0,
            context: e.context,
        });
    }
    (Graph::from_parts(graph_nodes, graph_edges), stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::extract_file;

    fn edge<'g>(g: &'g Graph, from: &str, to: &str) -> Option<&'g Edge> {
        g.edges.iter().find(|e| {
            g.nodes[e.src].label == from && g.nodes[e.dst].label == to && e.relation == "calls"
        })
    }

    #[test]
    fn calls_resolve_same_file_first_then_uniquely_within_the_package() {
        let a = extract_file(
            "a.rs",
            b"fn run() { local(); remote(); missing(); new(); }\nfn local() {}",
        );
        let b = extract_file("b.rs", b"pub fn remote() {}\npub fn new() {}");
        let (g, stats) = assemble(vec![a, b]);
        assert_eq!(
            edge(&g, "run()", "local()").map(|e| e.confidence),
            Some(Confidence::Extracted)
        );
        assert_eq!(
            edge(&g, "run()", "remote()").map(|e| e.confidence),
            Some(Confidence::Inferred)
        );
        assert!(
            edge(&g, "run()", "new()").is_none(),
            "generic names are not resolved across files"
        );
        assert_eq!(stats.cross_file, 1);
        assert_eq!(stats.unresolved, 1);
    }

    fn crates() -> AssembleContext {
        let mut package_of = HashMap::new();
        for (file, krate) in [
            ("src/sys/lib.rs", "bun_sys"),
            ("src/sys/file.rs", "bun_sys"),
            ("src/sys/windows/mod.rs", "bun_sys"),
            ("src/core/lib.rs", "bun_core"),
            ("src/core/strings.rs", "bun_core"),
            ("src/runtime/node/fs.rs", "bun_runtime"),
            ("src/install/lib.rs", "bun_install"),
        ] {
            package_of.insert(file.to_owned(), krate.to_owned());
        }
        let package_dir = [("bun_sys", "src/sys"), ("bun_core", "src/core")]
            .into_iter()
            .map(|(k, d)| (k.to_owned(), d.to_owned()))
            .collect();
        AssembleContext {
            package_of,
            package_dir,
        }
    }

    #[test]
    fn rust_calls_cross_crates_through_use_paths_qualified_names_and_receiver_types() {
        let sys = extract_file(
            "src/sys/lib.rs",
            b"pub fn open(p: &str) {}\npub fn close() {}\n",
        );
        let file = extract_file(
            "src/sys/file.rs",
            b"pub struct File;\nimpl File {\n pub fn read_all(&self) {}\n pub fn new() -> Self { File }\n}\n",
        );
        let windows = extract_file(
            "src/sys/windows/mod.rs",
            b"pub fn open(p: &str) {}\npub fn close() {}\n",
        );
        let core = extract_file(
            "src/core/strings.rs",
            b"pub fn eql(a: &str, b: &str) -> bool { a == b }\n",
        );
        let install = extract_file(
            "src/install/lib.rs",
            b"pub fn open(p: &str) {}\npub fn eql() {}\npub fn close() {}\n",
        );
        let fs = extract_file(
            "src/runtime/node/fs.rs",
            b"use bun_sys::{self as sys, File};\nuse bun_core::strings;\n\
              fn read(path: &str) {\n  sys::open(path);\n  let g = File::new();\n  g.read_all();\n  strings::eql(path, path);\n  bun_sys::close();\n}\n\
              fn typed(file: &File) { file.read_all(); }\n",
        );
        let (g, stats) = assemble_with(vec![sys, file, windows, core, install, fs], &crates());
        let to = |from: &str, to: &str| {
            edge(&g, from, to).map(|e| {
                (
                    g.nodes[e.dst].file.clone().unwrap_or_default(),
                    e.confidence,
                )
            })
        };
        assert_eq!(
            to("read()", "open()"),
            Some(("src/sys/lib.rs".into(), Confidence::Inferred))
        );
        assert_eq!(
            to("read()", "close()"),
            Some(("src/sys/lib.rs".into(), Confidence::Inferred))
        );
        assert_eq!(
            to("read()", ".new()"),
            Some(("src/sys/file.rs".into(), Confidence::Inferred))
        );
        assert_eq!(
            to("read()", ".read_all()"),
            Some(("src/sys/file.rs".into(), Confidence::Inferred))
        );
        assert_eq!(
            to("typed()", ".read_all()"),
            Some(("src/sys/file.rs".into(), Confidence::Inferred))
        );
        assert_eq!(
            to("read()", "eql()"),
            Some(("src/core/strings.rs".into(), Confidence::Inferred))
        );
        assert!(
            !g.edges.iter().any(|e| e.relation == "calls"
                && g.nodes[e.dst].file.as_deref() == Some("src/install/lib.rs")),
            "no homonym of another crate"
        );
        assert!(stats.cross_file >= 6, "{stats:?}");
        assert!(
            g.nodes
                .iter()
                .any(|n| n.package.as_deref() == Some("bun_sys"))
        );
    }

    #[test]
    fn plain_calls_never_reach_a_homonym_of_another_package() {
        let a = extract_file("src/install/lib.rs", b"fn go() { helper(); }\n");
        let b = extract_file("src/core/lib.rs", b"pub fn helper() {}\n");
        let (g, stats) = assemble_with(vec![a, b], &crates());
        assert!(edge(&g, "go()", "helper()").is_none());
        assert_eq!(stats.unresolved, 1);
    }

    #[test]
    fn js_imports_resolve_relative_and_alias_paths_and_skip_builtins() {
        let main = extract_file(
            "src/js/node/fs.ts",
            b"import { join } from \"node:path\";\nconst { validate } = require(\"internal/validators\");\nimport { square } from './math';\nexport function run() { join(); validate(); square(); local(); }\nfunction local() {}\n",
        );
        let math = extract_file("src/js/node/math.ts", b"export function square() {}\n");
        let validators = extract_file(
            "src/js/internal/validators.ts",
            b"export function validate() {}\n",
        );
        let path = extract_file("src/node-fallbacks/path.js", b"export function join() {}\n");
        let (g, stats) = assemble(vec![main, math, validators, path]);
        assert_eq!(
            edge(&g, "run()", "square()").map(|e| e.confidence),
            Some(Confidence::Extracted)
        );
        assert_eq!(
            edge(&g, "run()", "validate()").map(|e| e.confidence),
            Some(Confidence::Inferred)
        );
        assert_eq!(
            edge(&g, "run()", "local()").map(|e| e.confidence),
            Some(Confidence::Extracted)
        );
        assert!(
            edge(&g, "run()", "join()").is_none(),
            "node:path is not src/node-fallbacks/path.js"
        );
        assert_eq!(stats.external, 1);
        assert_eq!(stats.imports_external, 1);
        let imports_from: Vec<&str> = g
            .edges
            .iter()
            .filter(|e| e.relation == "imports_from")
            .map(|e| g.nodes[e.dst].label.as_str())
            .collect();
        assert!(
            imports_from.contains(&"math.ts") && imports_from.contains(&"validators.ts"),
            "{imports_from:?}"
        );
    }

    #[test]
    fn symbols_of_same_named_files_stay_distinct() {
        let a = extract_file("pkg/a/index.ts", b"export function run() {}\n");
        let b = extract_file("pkg/b/index.ts", b"export function run() {}\n");
        let (g, _) = assemble(vec![a, b]);
        assert_eq!(g.nodes.iter().filter(|n| n.label == "run()").count(), 2);
    }

    #[test]
    fn markdown_links_connect_notes() {
        let index = extract_file(
            "memory/MEMORY.md",
            b"# Index\n- [Build](build.md)\n- [[idioms]]\n",
        );
        let build = extract_file("memory/build.md", b"# Build\n");
        let idioms = extract_file("memory/idioms.md", b"# Idioms\n");
        let (g, stats) = assemble(vec![index, build, idioms]);
        let refs: Vec<(&str, Confidence)> = g
            .edges
            .iter()
            .filter(|e| e.relation == "references")
            .map(|e| (g.nodes[e.dst].label.as_str(), e.confidence))
            .collect();
        assert_eq!(
            refs,
            [
                ("build.md", Confidence::Extracted),
                ("idioms.md", Confidence::Inferred)
            ]
        );
        assert_eq!(stats.imports_resolved, 2);
        assert!(
            g.nodes
                .iter()
                .any(|n| n.label == "Index" && n.kind == NodeKind::Document)
        );
    }

    #[test]
    fn duplicate_file_names_get_the_shortest_unique_path_suffix() {
        let a = extract_file("crates/a/src/error.rs", b"fn x() {}");
        let b = extract_file("crates/b/src/error.rs", b"fn y() {}");
        let c = extract_file("crates/c/src/only.rs", b"fn z() {}");
        let (g, _) = assemble(vec![a, b, c]);
        let labels: Vec<&str> = g
            .nodes
            .iter()
            .filter(|n| n.loc.as_deref() == Some("L1"))
            .map(|n| n.label.as_str())
            .collect();
        assert!(
            labels.contains(&"a/src/error.rs") && labels.contains(&"b/src/error.rs"),
            "{labels:?}"
        );
        assert!(labels.contains(&"only.rs"));
    }

    #[test]
    fn type_stubs_fold_onto_their_unique_definition() {
        let a = extract_file("a.rs", b"pub struct Thing;");
        let b = extract_file("b.rs", b"fn use_it(t: Thing) {}");
        let (g, stats) = assemble(vec![a, b]);
        assert_eq!(stats.stubs_folded, 1);
        let r = g
            .edges
            .iter()
            .find(|e| e.relation == "references")
            .expect("reference edge");
        assert_eq!(g.nodes[r.dst].file.as_deref(), Some("a.rs"));
        assert!(
            !g.nodes
                .iter()
                .any(|n| n.file.is_none() && n.label == "Thing")
        );
    }
}
