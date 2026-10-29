// SPDX-License-Identifier: Apache-2.0
//! Native store commands. Package resolution/install is a separate capability;
//! ingesting a blob never claims to have installed an ecosystem package.
mod remote;
pub use remote::{execute_remote, metadata_client};

use crate::store::{BlobId, Store};
use clap::{Parser, Subcommand};
use serde_json::{Value, json};
use std::ffi::OsString;
use std::fs::File;
use std::io::{self, Write};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Parser)]
#[command(name = "pkg", about = "Verified native package blob store")]
pub struct Cli {
    /// Store root. Otherwise uses the explicitly configured APHRODY_HOME/store.
    #[arg(long, global = true)]
    pub store: Option<PathBuf>,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Fetch metadata from the source's public registry; no packages installed.
    RemoteInfo {
        #[arg(long)]
        source: String,
        package: String,
        #[arg(long)]
        version: Option<String>,
    },
    /// Search a public registry. Returns its original search response.
    Search {
        #[arg(long)]
        source: String,
        query: String,
        #[arg(long, default_value_t = 20)]
        limit: u16,
    },
    /// Inspect a previously fetched index. No resolution or installation implied.
    Info {
        #[arg(long)]
        source: String,
        package: String,
        #[arg(long)]
        index: PathBuf,
        #[arg(long)]
        version: Option<String>,
    },
    /// Manage content-addressed blobs; this does not install packages.
    Store {
        #[command(subcommand)]
        command: StoreCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum StoreCommand {
    Stats,
    /// Ingest a file, optionally checking its declared SHA-256 and pinning it.
    Put {
        file: PathBuf,
        #[arg(long)]
        expected: Option<String>,
        #[arg(long)]
        owner: Option<String>,
    },
    Verify {
        digest: String,
    },
    Materialize {
        digest: String,
        destination: PathBuf,
    },
    Pin {
        owner: String,
        digest: String,
    },
    Unpin {
        owner: String,
        digest: String,
    },
    /// Collect unreferenced blobs. Defaults to reporting without deletion.
    Gc {
        #[arg(long)]
        apply: bool,
        /// Minimum blob age in seconds (default: one day).
        #[arg(long, default_value_t = 86400)]
        min_age: u64,
    },
}

impl Cli {
    /// Native async adapter shared by standalone and the Aphrody multicall.
    /// Local commands need neither an HTTP client nor TLS initialization.
    pub async fn execute_native(&self, configured_home: Option<PathBuf>) -> io::Result<Value> {
        if matches!(
            self.command,
            Command::RemoteInfo { .. } | Command::Search { .. }
        ) {
            execute_remote(&self.command, metadata_client()?).await
        } else {
            self.execute(configured_home)
        }
    }

    /// The caller can supply a domain-specific resolved home. Ambient provider
    /// stores are never guessed, scanned, or imported.
    pub fn execute(&self, configured_home: Option<PathBuf>) -> io::Result<Value> {
        if matches!(
            self.command,
            Command::RemoteInfo { .. } | Command::Search { .. }
        ) {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "remote commands require execute_remote with an injected HTTP client",
            ));
        }
        if let Command::Info {
            source,
            package,
            index,
            version,
        } = &self.command
        {
            return inspect_index(source, package, index, version.as_deref());
        }
        let root = self
            .store
            .clone()
            .or_else(|| configured_home.map(|home| home.join("store")))
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "set --store or configure APHRODY_HOME (use the selected profile home)",
                )
            })?;
        if root.as_os_str().is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "empty store root",
            ));
        }
        let store = Store::new(&root);
        let Command::Store { command } = &self.command else {
            unreachable!("info handled above")
        };
        match command {
            StoreCommand::Stats => {
                let stats = store.stats()?;
                Ok(json!({"store":root,"blobs":stats.blobs,"bytes":stats.bytes}))
            }
            StoreCommand::Put {
                file,
                expected,
                owner,
            } => {
                let expected = expected.as_deref().map(BlobId::parse).transpose()?;
                let file = File::open(file)?;
                let id = match owner {
                    Some(owner) => store.put_and_pin(owner, file, expected.as_ref())?,
                    None => store.put(file, expected.as_ref())?,
                };
                Ok(json!({"digest":id.as_str(),"pinned":owner.is_some()}))
            }
            StoreCommand::Verify { digest } => {
                let id = BlobId::parse(digest)?;
                store.verify(&id)?;
                Ok(json!({"digest":id.as_str(),"verified":true}))
            }
            StoreCommand::Materialize {
                digest,
                destination,
            } => {
                let id = BlobId::parse(digest)?;
                let method = store.materialize_with_method(&id, destination)?;
                Ok(json!({"digest":id.as_str(),"destination":destination,
                    "method":format!("{method:?}").to_ascii_lowercase()}))
            }
            StoreCommand::Pin { owner, digest } => {
                let id = BlobId::parse(digest)?;
                store.pin(owner, &id)?;
                Ok(json!({"digest":id.as_str(),"owner":owner,"pinned":true}))
            }
            StoreCommand::Unpin { owner, digest } => {
                let id = BlobId::parse(digest)?;
                let removed = store.unpin(owner, &id)?;
                Ok(json!({"digest":id.as_str(),"owner":owner,"removed":removed}))
            }
            StoreCommand::Gc { apply, min_age } => {
                let report = store.gc(Duration::from_secs(*min_age), *apply)?;
                Ok(json!({"apply":apply,"minimumAgeSeconds":min_age,
                    "eligibleBlobs":report.eligible_blobs,"eligibleBytes":report.eligible_bytes,
                    "removedBlobs":report.removed_blobs,"removedBytes":report.removed_bytes}))
            }
        }
    }
}

fn inspect_index(
    source: &str,
    package: &str,
    path: &std::path::Path,
    version: Option<&str>,
) -> io::Result<Value> {
    // Bound input before allocation. The CLI consumes an explicit local index;
    // it never interprets a registry URL or performs implicit remote operations.
    let mut file = File::open(path)?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(
        &mut std::io::Read::take(&mut file, 64 * 1024 * 1024 + 1),
        &mut bytes,
    )?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "index exceeds 64 MiB",
        ));
    }
    inspect_bytes(source, package, &bytes, version)
}

fn inspect_bytes(
    source: &str,
    package: &str,
    bytes: &[u8],
    version: Option<&str>,
) -> io::Result<Value> {
    use crate::metadata::indexes;
    let decoded = match source {
        "npm" => indexes::npm_packument(package, bytes),
        "cargo" => indexes::cargo_sparse(package, bytes),
        "nuget" => indexes::nuget_flatcontainer(package, bytes),
        "vcpkg" => indexes::vcpkg_versions(package, bytes),
        other => {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                format!("index decoder unavailable for {other}"),
            ));
        }
    }
    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let packages: Vec<Value> = decoded.packages.iter()
        .filter(|p| version.is_none_or(|wanted| p.version == wanted))
        .map(|p| json!({"name":p.name,"version":p.version,"scheme":format!("{:?}",p.scheme),
            "artifact":p.artifact,"integrity":p.integrity,"withdrawn":p.withdrawn,
            "dependencies":p.dependencies.iter().map(|d| json!({"source":d.source,
                "name":d.name,"requirement":d.requirement,"optional":d.optional,"target":d.target})).collect::<Vec<_>>(),
            "record":decoded.records.get(&p.version)})).collect();
    if version.is_some() && packages.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "requested version is not present in index",
        ));
    }
    Ok(json!({"source":source,"package":package,"packages":packages,"metadata":decoded.metadata}))
}

/// Multicall entry point. Arguments include argv[0]. Writes one JSON result.
pub fn cli_main(args: impl IntoIterator<Item = OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(error) => {
            let code = error.exit_code();
            let _ = error.print();
            return code;
        }
    };
    let home = std::env::var_os("APHRODY_HOME")
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let result = (|| {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        runtime.block_on(cli.execute_native(home))
    })();
    match result {
        Ok(value) => match writeln!(io::stdout().lock(), "{value}") {
            Ok(()) => 0,
            Err(error) => {
                eprintln!("package output: {error}");
                1
            }
        },
        Err(error) => {
            eprintln!("package store: {error}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_preserves_records_without_store_configuration() -> io::Result<()> {
        let temporary = tempfile::tempdir()?;
        let index = temporary.path().join("index.json");
        std::fs::write(&index, br#"{"versions":{"1.0.0":{"name":"demo","version":"1.0.0","peerDependencies":{"react":"19"}}}}"#)?;
        let cli = Cli {
            store: None,
            command: Command::Info {
                source: "npm".into(),
                package: "demo".into(),
                index,
                version: Some("1.0.0".into()),
            },
        };
        let value = cli.execute(None)?;
        assert_eq!(
            value["packages"][0]["record"]["peerDependencies"]["react"],
            "19"
        );
        Ok(())
    }

    #[test]
    fn gc_is_report_only_by_default() {
        let cli = Cli::try_parse_from(["pkg", "store", "gc"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Store {
                command: StoreCommand::Gc {
                    apply: false,
                    min_age: 86400
                }
            }
        ));
        assert!(Cli::try_parse_from(["pkg", "store", "gc", "--min-age", "-1"]).is_err());
    }

    #[test]
    fn store_lifecycle_preserves_pins_and_requires_apply() -> io::Result<()> {
        let temporary = tempfile::tempdir()?;
        let root = temporary.path().join("store");
        let input = temporary.path().join("input");
        std::fs::write(&input, b"package")?;
        let run = |command| {
            Cli {
                store: Some(root.clone()),
                command: Command::Store { command },
            }
            .execute(None)
        };
        let value = run(StoreCommand::Put {
            file: input,
            expected: None,
            owner: Some("test".into()),
        })?;
        let digest = value["digest"].as_str().unwrap().to_owned();
        assert_eq!(
            run(StoreCommand::Gc {
                apply: true,
                min_age: 0
            })?["removedBlobs"],
            0
        );
        run(StoreCommand::Unpin {
            owner: "test".into(),
            digest: digest.clone(),
        })?;
        assert_eq!(
            run(StoreCommand::Gc {
                apply: false,
                min_age: 0
            })?["eligibleBlobs"],
            1
        );
        run(StoreCommand::Verify {
            digest: digest.clone(),
        })?;
        let output = temporary.path().join("output");
        run(StoreCommand::Materialize {
            digest: digest.clone(),
            destination: output.clone(),
        })?;
        assert_eq!(std::fs::read(output)?, b"package");
        assert_eq!(
            run(StoreCommand::Gc {
                apply: true,
                min_age: 0
            })?["removedBlobs"],
            1
        );
        assert!(run(StoreCommand::Verify { digest }).is_err());
        Ok(())
    }

    #[test]
    fn missing_configuration_is_error_and_home_is_domain_specific() -> io::Result<()> {
        let cli = Cli::try_parse_from(["pkg", "store", "stats"]).unwrap();
        assert!(cli.execute(None).is_err());
        let root = tempfile::tempdir()?;
        let home = root.path().join("profile-ie");
        let result = cli.execute(Some(home.clone()))?;
        assert_eq!(result["store"], json!(home.join("store")));
        Ok(())
    }
}
