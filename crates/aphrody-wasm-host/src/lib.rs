// SPDX-License-Identifier: MIT
//! Server-side WebAssembly plugin host of Bun OS.
//!
//! Runs WASI 0.2 command components (`wasi:cli/run`) in Wasmtime with explicit limits: fuel, wall-clock timeout
//! (epoch interruption), linear-memory ceiling and read-only or read-write directory preopens. Standard output and
//! error are captured in memory, or inherited from the host process. Nothing is reachable from the guest that the
//! caller did not grant: no inherited environment, no sockets, no ambient filesystem.
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store, StoreLimits, StoreLimitsBuilder, Trap};
use wasmtime_wasi::p2::bindings::sync::CommandPre;
use wasmtime_wasi::p2::pipe::MemoryOutputPipe;
use wasmtime_wasi::{FsPerms, I32Exit, WasiCtx, WasiCtxView, WasiView};

pub use wasmtime::{Error, Result};

/// Directory granted to the guest.
#[derive(Clone, Debug)]
pub struct Preopen {
    pub host: PathBuf,
    pub guest: String,
    pub writable: bool,
}

/// Limits and capabilities of one run.
#[derive(Clone, Debug)]
pub struct RunOptions {
    /// `argv[1..]`; `argv[0]` is the component name.
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub preopens: Vec<Preopen>,
    /// Instruction budget; `None` disables fuel metering.
    pub fuel: Option<u64>,
    /// Wall-clock budget; `None` runs until the guest returns.
    pub timeout: Option<Duration>,
    /// Ceiling of every linear memory, in bytes.
    pub max_memory: usize,
    /// Capture stdout/stderr (true) or inherit the host's (false).
    pub capture: bool,
    /// Bytes fed to the guest's stdin.
    pub stdin: Vec<u8>,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            args: Vec::new(),
            env: Vec::new(),
            preopens: Vec::new(),
            fuel: None,
            timeout: Some(Duration::from_secs(30)),
            max_memory: 512 << 20,
            capture: true,
            stdin: Vec::new(),
        }
    }
}

/// Why the run ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Exit {
    /// `wasi:cli/run` returned or the guest called `exit`.
    Code(i32),
    OutOfFuel,
    Timeout,
    /// Any other trap, with its message.
    Trap(String),
}

#[derive(Clone, Debug)]
pub struct RunOutcome {
    pub exit: Exit,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

struct State {
    ctx: WasiCtx,
    table: ResourceTable,
    limits: StoreLimits,
}

impl WasiView for State {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView { ctx: &mut self.ctx, table: &mut self.table }
    }
}

/// Compiles and runs components; one `Host` is shared by every run (the engine caches nothing across processes).
pub struct Host {
    engine: Engine,
    linker: Linker<State>,
}

impl Host {
    pub fn new() -> Result<Self> {
        let mut config = Config::new();
        config.wasm_component_model(true).epoch_interruption(true).consume_fuel(true);
        let engine = Engine::new(&config)?;
        let mut linker = Linker::new(&engine);
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker)?;
        Ok(Self { engine, linker })
    }

    /// Compiles a component from its binary or WAT text.
    pub fn compile(&self, bytes: &[u8]) -> Result<Component> {
        Component::new(&self.engine, bytes)
    }

    /// Runs `wasi:cli/run` of a compiled component.
    pub fn run(&self, name: &str, component: &Component, opts: &RunOptions) -> Result<RunOutcome> {
        let pre = CommandPre::new(self.linker.instantiate_pre(component)?)?;
        let stdout = MemoryOutputPipe::new(16 << 20);
        let stderr = MemoryOutputPipe::new(16 << 20);
        let mut wasi = WasiCtx::builder();
        wasi.arg(name).args(&opts.args).envs(&opts.env);
        wasi.stdin(wasmtime_wasi::p2::pipe::MemoryInputPipe::new(opts.stdin.clone()));
        if opts.capture {
            wasi.stdout(stdout.clone()).stderr(stderr.clone());
        } else {
            wasi.inherit_stdout().inherit_stderr();
        }
        for p in &opts.preopens {
            let perms = if p.writable { FsPerms::ReadWrite } else { FsPerms::ReadOnly };
            wasi.preopened_dir(&p.host, &p.guest, perms)?;
        }
        let limits = StoreLimitsBuilder::new().memory_size(opts.max_memory).instances(64).build();
        let mut store = Store::new(&self.engine, State { ctx: wasi.build(), table: ResourceTable::new(), limits });
        store.limiter(|s| &mut s.limits);
        store.set_fuel(opts.fuel.unwrap_or(u64::MAX))?;
        store.set_epoch_deadline(1);

        let (done, finished) = mpsc::channel::<()>();
        let watchdog = opts.timeout.map(|limit| {
            let engine = self.engine.clone();
            std::thread::spawn(move || {
                if finished.recv_timeout(limit).is_err() {
                    engine.increment_epoch();
                }
            })
        });
        let result = pre.instantiate(&mut store).and_then(|cmd| cmd.wasi_cli_run().call_run(&mut store));
        let _ = done.send(());
        if let Some(w) = watchdog {
            let _ = w.join();
        }

        let exit = match result {
            Ok(Ok(())) => Exit::Code(0),
            Ok(Err(())) => Exit::Code(1),
            Err(e) => {
                if let Some(code) = e.downcast_ref::<I32Exit>() {
                    Exit::Code(code.0)
                } else {
                    match e.downcast_ref::<Trap>() {
                        Some(Trap::OutOfFuel) => Exit::OutOfFuel,
                        Some(Trap::Interrupt) => Exit::Timeout,
                        _ => Exit::Trap(format!("{e:?}")),
                    }
                }
            }
        };
        drop(store);
        Ok(RunOutcome { exit, stdout: stdout.contents().to_vec(), stderr: stderr.contents().to_vec() })
    }
}
