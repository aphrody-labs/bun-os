// SPDX-License-Identifier: Apache-2.0
//! Versioned C ABI of the precompiled YOLO native runtime.
//!
//! First vertical slice (phase R0 of PLAN.md): one capability family (system statistics and a
//! cancellable benchmark, both from `yolo-core`) behind a stable boundary.
//!
//! Contract (see `docs/architecture/runtime-native/RUNTIME-ABI.md`):
//! - no Rust type crosses the boundary; everything is `repr(C)`, integers, pointers or buffers;
//! - objects are opaque 64-bit handles (index + generation) owned by this library, so a stale or
//!   forged handle is rejected instead of dereferenced;
//! - buffers returned to the caller are owned by this library and released with
//!   [`yolo_buffer_free`];
//! - every entry point converts panics into [`YoloStatus::Panic`]; this needs an unwinding
//!   profile (`cargo build --profile runtime`), the plain release profile aborts instead;
//! - long operations run on bounded worker threads and can be cancelled, waited with a timeout
//!   and released; destroying a runtime cancels and joins its operations first.

mod process;
pub use process::*;
mod buv;
pub use buv::*;
// The GPU provider is an extension owned by the Bun OS workspace: it defines the feature
// and points YOLO_EXT_DIR at the directory holding gpu.rs, which share
// this module's internals through `use super::*`.
#[cfg(feature = "gpu")]
mod gpu {
    include!(concat!(env!("YOLO_EXT_DIR"), "/gpu.rs"));
}
#[cfg(feature = "gpu")]
pub use gpu::*;

use std::cell::RefCell;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

pub const ABI_MAJOR: u32 = 1;
pub const ABI_MINOR: u32 = 6;
/// Upper bound for `max_operations`.
pub const MAX_OPERATIONS_LIMIT: u32 = 64;
const DEFAULT_MAX_OPERATIONS: u32 = 4;

/// Opaque handle. `0` is never valid.
pub type YoloHandle = u64;

#[repr(i32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum YoloStatus {
    Ok = 0,
    InvalidArgument = 1,
    AbiMismatch = 2,
    InvalidHandle = 3,
    Cancelled = 4,
    Timeout = 5,
    Busy = 6,
    Internal = 7,
    Panic = 8,
    OutputLimit = 9,
}

/// Buffer owned by the library. Release it with [`yolo_buffer_free`].
/// Only `len` bytes may be read; `cap` is allocator metadata and may exceed `len`.
/// Keep all three fields unchanged until release, including for an empty buffer.
#[repr(C)]
#[derive(Debug)]
pub struct YoloBuffer {
    pub data: *mut u8,
    pub len: usize,
    pub cap: usize,
}

/// Sized, versioned creation parameters: `struct_size` lets the library accept older callers
/// and reject truncated structures.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct YoloCreateInfo {
    pub struct_size: u32,
    pub abi_major: u32,
    pub abi_minor: u32,
    /// Maximum concurrent operations, `0` selects the default.
    pub max_operations: u32,
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

thread_local! {
  static LAST_ERROR: RefCell<Option<String>> = const { RefCell::new(None) };
}

pub(crate) fn set_error(status: YoloStatus, message: impl Into<String>) -> YoloStatus {
    let message = message.into();
    LAST_ERROR.with(|e| *e.borrow_mut() = Some(message));
    status
}

pub(crate) fn guard(f: impl FnOnce() -> YoloStatus) -> YoloStatus {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(status) => status,
        Err(payload) => {
            let detail = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic".to_string());
            set_error(YoloStatus::Panic, format!("panic: {detail}"))
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------------------------

pub(crate) fn write_buffer(out: *mut YoloBuffer, bytes: Vec<u8>) -> YoloStatus {
    if out.is_null() {
        return set_error(YoloStatus::InvalidArgument, "null output buffer");
    }
    let (data, len, cap) = bytes.into_raw_parts();
    // SAFETY: `out` is non-null and the caller guarantees it points to a writable `YoloBuffer`.
    unsafe { out.write(YoloBuffer { data, len, cap }) };
    YoloStatus::Ok
}

pub(crate) fn write_json(out: *mut YoloBuffer, value: &impl serde::Serialize) -> YoloStatus {
    match serde_json::to_vec(value) {
        Ok(bytes) => write_buffer(out, bytes),
        Err(error) => set_error(
            YoloStatus::Internal,
            format!("serialization failed: {error}"),
        ),
    }
}

/// Releases a buffer returned by this library and zeroes it. A zeroed buffer is a no-op.
///
/// # Safety
/// `buffer` must be null or point to a zeroed or live `YoloBuffer` produced by this library.
/// The caller must preserve its `data`, `len` and `cap` fields and must not release a copy.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_buffer_free(buffer: *mut YoloBuffer) {
    if buffer.is_null() {
        return;
    }
    // SAFETY: guaranteed by the caller, see above.
    let b = unsafe { &mut *buffer };
    if !b.data.is_null() {
        // SAFETY: these unchanged parts came from `Vec::into_raw_parts` in this library.
        // Reclaim the original capacity with the same allocator, including when len is zero.
        drop(unsafe { Vec::from_raw_parts(b.data, b.len, b.cap) });
    }
    *b = YoloBuffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
    };
}

/// Last error of the calling thread as JSON `{"status":…,"message":…}`; empty if none.
///
/// # Safety
/// `out` must point to a writable `YoloBuffer`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_last_error(out: *mut YoloBuffer) -> YoloStatus {
    guard(|| {
        let message = LAST_ERROR.with(|e| e.borrow().clone()).unwrap_or_default();
        write_json(out, &serde_json::json!({ "message": message }))
    })
}

// ---------------------------------------------------------------------------------------------
// Handle registry
// ---------------------------------------------------------------------------------------------

#[derive(Debug)]
pub(crate) enum OpResult {
    Done(String),
    Cancelled,
    Failed(String),
    Status(YoloStatus, String),
}

#[derive(Debug)]
pub(crate) struct OpState {
    counted: bool,
    cancel: AtomicBool,
    result: Mutex<Option<OpResult>>,
    done: Condvar,
}

impl OpState {
    fn finish(&self, result: OpResult) {
        *lock(&self.result) = Some(result);
        self.done.notify_all();
    }
}

pub(crate) enum Entry {
    Runtime {
        max_operations: u32,
    },
    Operation {
        owner: YoloHandle,
        state: Arc<OpState>,
        thread: Option<JoinHandle<()>>,
    },
    Process {
        owner: YoloHandle,
        state: Arc<process::ProcState>,
    },
}

struct Slot {
    generation: u32,
    entry: Option<Entry>,
}

#[derive(Default)]
pub(crate) struct Registry {
    slots: Vec<Slot>,
    free: Vec<usize>,
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(Mutex::default)
}

fn encode(index: usize, generation: u32) -> YoloHandle {
    ((generation as u64) << 32) | (index as u64 + 1)
}

fn decode(handle: YoloHandle) -> Option<(usize, u32)> {
    let index = (handle & 0xffff_ffff) as usize;
    (index != 0).then(|| (index - 1, (handle >> 32) as u32))
}

impl Registry {
    pub(crate) fn insert(&mut self, entry: Entry) -> YoloHandle {
        if let Some(index) = self.free.pop() {
            let slot = &mut self.slots[index];
            slot.entry = Some(entry);
            encode(index, slot.generation)
        } else {
            self.slots.push(Slot {
                generation: 1,
                entry: Some(entry),
            });
            encode(self.slots.len() - 1, 1)
        }
    }

    pub(crate) fn get(&self, handle: YoloHandle) -> Option<&Entry> {
        let (index, generation) = decode(handle)?;
        let slot = self.slots.get(index)?;
        (slot.generation == generation)
            .then_some(slot.entry.as_ref())
            .flatten()
    }

    pub(crate) fn remove(&mut self, handle: YoloHandle) -> Option<Entry> {
        let (index, generation) = decode(handle)?;
        let slot = self.slots.get_mut(index)?;
        if slot.generation != generation {
            return None;
        }
        let entry = slot.entry.take()?;
        // A new generation invalidates every copy of the old handle.
        slot.generation = slot.generation.wrapping_add(1).max(1);
        self.free.push(index);
        Some(entry)
    }

    pub(crate) fn operations_of(&self, owner: YoloHandle) -> Vec<YoloHandle> {
        self.slots
            .iter()
            .enumerate()
            .filter_map(|(index, slot)| match &slot.entry {
                Some(Entry::Operation { owner: o, .. } | Entry::Process { owner: o, .. })
                    if *o == owner =>
                {
                    Some(encode(index, slot.generation))
                }
                _ => None,
            })
            .collect()
    }

    pub(crate) fn capacity_used_by(&self, owner: YoloHandle) -> usize {
        self.slots
            .iter()
            .filter(|slot| match &slot.entry {
                Some(Entry::Operation {
                    owner: entry_owner,
                    state,
                    ..
                }) => *entry_owner == owner && state.counted,
                Some(Entry::Process {
                    owner: entry_owner, ..
                }) => *entry_owner == owner,
                _ => false,
            })
            .count()
    }
}

pub(crate) fn runtime_limit(reg: &Registry, runtime: YoloHandle) -> Result<u32, YoloStatus> {
    match reg.get(runtime) {
        Some(Entry::Runtime { max_operations }) => Ok(*max_operations),
        _ => Err(set_error(
            YoloStatus::InvalidHandle,
            "invalid runtime handle",
        )),
    }
}

/// Cancels the operation and waits for its worker. Never called with the registry locked.
pub(crate) fn stop_operation(entry: Entry) {
    match entry {
        Entry::Operation { state, thread, .. } => {
            state.cancel.store(true, Ordering::SeqCst);
            if let Some(thread) = thread {
                let _ = thread.join();
            }
        }
        Entry::Process { state, .. } => state.stop(process::DESTROY_GRACE_MS),
        Entry::Runtime { .. } => {}
    }
}

// ---------------------------------------------------------------------------------------------
// Runtime lifecycle and information
// ---------------------------------------------------------------------------------------------

/// `(major << 16) | minor` of the ABI implemented by the loaded library. Call it before any
/// other function and refuse a library whose major differs from the one you were built for.
#[unsafe(no_mangle)]
pub extern "C" fn yolo_abi_version() -> u32 {
    (ABI_MAJOR << 16) | ABI_MINOR
}

/// Creates a runtime.
///
/// # Safety
/// `info` must point to a readable `YoloCreateInfo` (at least `struct_size` bytes) and `out` to
/// a writable `YoloHandle`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_runtime_create(
    info: *const YoloCreateInfo,
    out: *mut YoloHandle,
) -> YoloStatus {
    guard(|| {
        if info.is_null() || out.is_null() {
            return set_error(YoloStatus::InvalidArgument, "null argument");
        }
        // The first two fields are enough to negotiate; read them before trusting the rest.
        // SAFETY: the caller guarantees `info` is readable for `struct_size` bytes (>= 4).
        let struct_size = unsafe { ptr::addr_of!((*info).struct_size).read_unaligned() };
        let full = size_of::<YoloCreateInfo>() as u32;
        if struct_size < 12 {
            return set_error(YoloStatus::InvalidArgument, "struct_size too small");
        }
        // SAFETY: at least 12 bytes (struct_size, abi_major, abi_minor) are readable.
        let (major, minor) = unsafe {
            (
                ptr::addr_of!((*info).abi_major).read_unaligned(),
                ptr::addr_of!((*info).abi_minor).read_unaligned(),
            )
        };
        if major != ABI_MAJOR || minor > ABI_MINOR {
            return set_error(
                YoloStatus::AbiMismatch,
                format!(
                    "caller expects ABI {major}.{minor}, library implements {ABI_MAJOR}.{ABI_MINOR}"
                ),
            );
        }
        let requested = if struct_size >= full {
            // SAFETY: the structure is fully readable.
            unsafe { ptr::addr_of!((*info).max_operations).read_unaligned() }
        } else {
            0
        };
        if requested > MAX_OPERATIONS_LIMIT {
            return set_error(
                YoloStatus::InvalidArgument,
                "max_operations above the limit",
            );
        }
        let max_operations = if requested == 0 {
            DEFAULT_MAX_OPERATIONS
        } else {
            requested
        };
        let handle = lock(registry()).insert(Entry::Runtime { max_operations });
        // SAFETY: `out` is writable per the contract.
        unsafe { out.write(handle) };
        YoloStatus::Ok
    })
}

/// Destroys a runtime after cancelling and joining every operation and stopping every process it
/// owns.
#[unsafe(no_mangle)]
pub extern "C" fn yolo_runtime_destroy(runtime: YoloHandle) -> YoloStatus {
    guard(|| {
        let removed = {
            let mut reg = lock(registry());
            if runtime_limit(&reg, runtime).is_err() {
                return YoloStatus::InvalidHandle;
            }
            let operations: Vec<Entry> = reg
                .operations_of(runtime)
                .into_iter()
                .filter_map(|h| reg.remove(h))
                .collect();
            reg.remove(runtime);
            operations
        };
        // Cancel every waiter before stopping processes, so registry order cannot publish a
        // successful wait during runtime teardown. Arc-owning concurrent callers remain valid.
        for entry in &removed {
            if let Entry::Operation { state, .. } = entry {
                state.cancel.store(true, Ordering::SeqCst);
            }
        }
        removed.into_iter().for_each(stop_operation);
        YoloStatus::Ok
    })
}

#[derive(serde::Serialize)]
struct BuildInfo {
    name: &'static str,
    version: &'static str,
    abi: String,
    target: &'static str,
    rustc: &'static str,
    git_rev: &'static str,
    /// Whether panics are converted to `YoloStatus::Panic` (unwinding profile).
    panic_recovery: bool,
}

/// Build identity of the artifact as JSON.
///
/// # Safety
/// `out` must point to a writable `YoloBuffer`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_runtime_build_info(out: *mut YoloBuffer) -> YoloStatus {
    runtime_build_info(out, "yolo-runtime")
}

fn runtime_build_info(out: *mut YoloBuffer, name: &'static str) -> YoloStatus {
    guard(|| {
        write_json(
            out,
            &BuildInfo {
                name,
                version: env!("CARGO_PKG_VERSION"),
                abi: format!("{ABI_MAJOR}.{ABI_MINOR}"),
                target: env!("YOLO_RUNTIME_TARGET"),
                rustc: env!("YOLO_RUNTIME_RUSTC"),
                git_rev: env!("YOLO_RUNTIME_GIT_REV"),
                panic_recovery: cfg!(panic = "unwind"),
            },
        )
    })
}

/// Capabilities of this runtime as a JSON array of identifiers.
///
/// # Safety
/// `out` must point to a writable `YoloBuffer`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_runtime_capabilities(
    runtime: YoloHandle,
    out: *mut YoloBuffer,
) -> YoloStatus {
    guard(|| {
        if let Err(status) = runtime_limit(&lock(registry()), runtime) {
            return status;
        }
        write_json(
            out,
            &[
                "system.stats",
                "bench.compute",
                "process.supervise",
                "http.probe",
                "process.stdin",
                "process.wait",
                #[cfg(feature = "gpu")]
                "gpu.info",
                #[cfg(feature = "gpu")]
                "gpu.wgsl",
                #[cfg(feature = "cuda")]
                "gpu.cuda",
            ],
        )
    })
}

// ---------------------------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------------------------

/// `system.stats`: operating system, architecture and timestamp as JSON.
///
/// # Safety
/// `out` must point to a writable `YoloBuffer`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_system_stats(
    runtime: YoloHandle,
    out: *mut YoloBuffer,
) -> YoloStatus {
    guard(|| {
        if let Err(status) = runtime_limit(&lock(registry()), runtime) {
            return status;
        }
        write_json(out, &yolo_core::current_system_stats())
    })
}

/// Starts `work` on a bounded worker thread owned by `runtime` and returns its operation handle.
/// `work` receives the cancellation flag; a panic becomes a failed operation. Unbounded operations
/// (cleanup such as stopping a process) ignore `max_operations` so they can never fail with `BUSY`.
pub(crate) fn start_operation(
    runtime: YoloHandle,
    name: &'static str,
    bounded: bool,
    work: impl FnOnce(&AtomicBool) -> OpResult + Send + 'static,
) -> Result<YoloHandle, YoloStatus> {
    let state = Arc::new(OpState {
        counted: bounded,
        cancel: AtomicBool::new(false),
        result: Mutex::new(None),
        done: Condvar::new(),
    });
    let mut reg = lock(registry());
    let limit = runtime_limit(&reg, runtime)?;
    if bounded && reg.capacity_used_by(runtime) as u32 >= limit {
        return Err(set_error(
            YoloStatus::Busy,
            format!("{limit} operations already running"),
        ));
    }
    let worker_state = Arc::clone(&state);
    let thread = std::thread::Builder::new()
        .name(format!("yolo-{name}"))
        .spawn(move || {
            let outcome = catch_unwind(AssertUnwindSafe(|| work(&worker_state.cancel)));
            worker_state.finish(
                outcome.unwrap_or_else(|_| OpResult::Failed(format!("{name} operation panicked"))),
            );
        })
        .map_err(|error| {
            set_error(
                YoloStatus::Internal,
                format!("cannot spawn worker: {error}"),
            )
        })?;
    Ok(reg.insert(Entry::Operation {
        owner: runtime,
        state,
        thread: Some(thread),
    }))
}

/// `bench.compute`: starts a cancellable benchmark and returns an operation handle.
///
/// # Safety
/// `out_operation` must point to a writable `YoloHandle`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_bench_start(
    runtime: YoloHandle,
    iterations: u32,
    out_operation: *mut YoloHandle,
) -> YoloStatus {
    guard(|| {
        if out_operation.is_null() {
            return set_error(YoloStatus::InvalidArgument, "null output handle");
        }
        let started = start_operation(runtime, "bench", true, move |cancel| {
            match yolo_core::compute_benchmark_cancellable(iterations, || {
                cancel.load(Ordering::Relaxed)
            }) {
                Some(result) => match serde_json::to_string(&result) {
                    Ok(json) => OpResult::Done(json),
                    Err(error) => OpResult::Failed(error.to_string()),
                },
                None => OpResult::Cancelled,
            }
        });
        match started {
            Ok(handle) => {
                // SAFETY: `out_operation` is writable per the contract.
                unsafe { out_operation.write(handle) };
                YoloStatus::Ok
            }
            Err(status) => status,
        }
    })
}

fn operation_state(operation: YoloHandle) -> Result<Arc<OpState>, YoloStatus> {
    match lock(registry()).get(operation) {
        Some(Entry::Operation { state, .. }) => Ok(Arc::clone(state)),
        _ => Err(set_error(
            YoloStatus::InvalidHandle,
            "invalid operation handle",
        )),
    }
}

/// Waits up to `timeout_ms` for the operation. Returns `Ok` with the JSON result in `out`,
/// `Timeout` (the operation keeps running and stays valid), `Cancelled`, or `Internal` with the
/// failure available through [`yolo_last_error`].
///
/// # Safety
/// `out` must point to a writable `YoloBuffer`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_operation_wait(
    operation: YoloHandle,
    timeout_ms: u32,
    out: *mut YoloBuffer,
) -> YoloStatus {
    guard(|| {
        if out.is_null() {
            return set_error(YoloStatus::InvalidArgument, "null output buffer");
        }
        let state = match operation_state(operation) {
            Ok(state) => state,
            Err(status) => return status,
        };
        let guard_ = lock(&state.result);
        let (result, _) = state
            .done
            .wait_timeout_while(guard_, Duration::from_millis(u64::from(timeout_ms)), |r| {
                r.is_none()
            })
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match result.as_ref() {
            None => set_error(YoloStatus::Timeout, "operation still running"),
            Some(OpResult::Done(json)) => write_buffer(out, json.clone().into_bytes()),
            Some(OpResult::Cancelled) => set_error(YoloStatus::Cancelled, "operation cancelled"),
            Some(OpResult::Failed(message)) => set_error(YoloStatus::Internal, message.clone()),
            Some(OpResult::Status(status, message)) => set_error(*status, message.clone()),
        }
    })
}

/// Requests cancellation. Idempotent; the result is observed with [`yolo_operation_wait`].
#[unsafe(no_mangle)]
pub extern "C" fn yolo_operation_cancel(operation: YoloHandle) -> YoloStatus {
    guard(|| match operation_state(operation) {
        Ok(state) => {
            state.cancel.store(true, Ordering::SeqCst);
            YoloStatus::Ok
        }
        Err(status) => status,
    })
}

/// Releases an operation: cancels it if still running, joins its worker and invalidates the
/// handle. Every started operation must be released.
#[unsafe(no_mangle)]
pub extern "C" fn yolo_operation_release(operation: YoloHandle) -> YoloStatus {
    guard(|| {
        let entry = {
            let mut reg = lock(registry());
            match reg.get(operation) {
                Some(Entry::Operation { .. }) => reg.remove(operation),
                _ => None,
            }
        };
        match entry {
            Some(entry) => {
                stop_operation(entry);
                YoloStatus::Ok
            }
            None => set_error(YoloStatus::InvalidHandle, "invalid operation handle"),
        }
    })
}

/// Sum of squares over a caller-owned `f64` slice, read in place (no copy).
///
/// # Safety
///
/// `ptr` must point to at least `len` readable `f64` values, or be NULL when `len == 0`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ffi_sum_squares(ptr: *const f64, len: usize) -> f64 {
    if ptr.is_null() || len == 0 {
        return 0.0;
    }
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    yolo_core::compute_sum_squares(slice)
}

#[cfg(test)]
mod tests;
