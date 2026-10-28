// SPDX-License-Identifier: Apache-2.0
//! Capability `process.supervise` and `http.probe`: spawn a child in its own process group
//! (a Job Object on Windows), observe it without blocking, stop it gracefully (SIGTERM, then
//! SIGKILL after a grace period; the whole job on Windows) and probe an HTTP endpoint for readiness. Everything a consumer needs to supervise a local
//! server without writing its own spawn/poll/kill code.

use super::*;
use std::collections::VecDeque;
use std::ffi::{CStr, c_char};
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Child, Command, Stdio};
use std::time::Instant;

/// Grace period used when a runtime is destroyed with processes still running.
pub(crate) const DESTROY_GRACE_MS: u32 = 500;
/// Grace period used by `yolo_process_release`.
const RELEASE_GRACE_MS: u32 = 2000;
/// `YoloSpawnInfo.flags`: connect the child's stdin/stdout/stderr to the null device.
pub const YOLO_SPAWN_NULL_STDIO: u32 = 1;
/// `YoloSpawnInfo.flags`: stdin is the null device, stdout and stderr are captured (the last
/// `CAPTURE_LIMIT` bytes of each are kept) and read with `yolo_process_read`.
pub const YOLO_SPAWN_CAPTURE: u32 = 2;
/// ABI 1.4: retain all captured bytes up to the explicit per-stream budget; never truncate.
pub const YOLO_SPAWN_CAPTURE_LOSSLESS: u32 = 4;
/// ABI 1.6: opt-in owned stdin pipe; combines with either capture flag.
pub const YOLO_SPAWN_PIPE_STDIN: u32 = 8;
/// Cumulative accepted stdin byte budget per process.
pub const YOLO_STDIN_MAX_BYTES: usize = 1024 * 1024;
/// Default and maximum per-stream budget for lossless capture.
pub const YOLO_CAPTURE_MAX_BYTES: usize = 64 * 1024 * 1024;
/// `yolo_process_read` streams.
pub const YOLO_STREAM_STDOUT: u32 = 1;
pub const YOLO_STREAM_STDERR: u32 = 2;
/// `yolo_process_read` modes: `DRAIN` returns and clears, `PEEK` returns without clearing.
pub const YOLO_READ_DRAIN: u32 = 0;
pub const YOLO_READ_PEEK: u32 = 1;
/// Bytes kept per captured stream; older bytes are dropped.
const CAPTURE_LIMIT: usize = 64 * 1024;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct YoloSpawnInfo {
  pub struct_size: u32,
  pub flags: u32,
  /// UTF-8, NUL-terminated.
  pub program: *const c_char,
  /// NULL-terminated array of NUL-terminated UTF-8 arguments (not including the program), or NULL.
  pub args: *const *const c_char,
  /// NULL-terminated array of `KEY=VALUE` entries added to the inherited environment (`KEY` alone
  /// removes the variable), or NULL.
  pub env: *const *const c_char,
  /// Working directory, or NULL.
  pub cwd: *const c_char,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct YoloProcessStatus {
  pub struct_size: u32,
  /// 0 = running, 1 = exited.
  pub state: u32,
  /// Exit code, or -1 when the process was terminated by a signal.
  pub exit_code: i32,
  /// Terminating signal on Unix, 0 otherwise.
  pub signal: i32,
  pub pid: u32,
}

#[derive(Clone, Copy)]
struct ExitInfo {
  code: Option<i32>,
  signal: Option<i32>,
}

// Only this worker accesses the read end. Poll before read so teardown can always join it.
trait CapturePipe: Read + Send + 'static {
  fn prepare(&self) -> io::Result<()>;
  fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<usize>;
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
  fn CancelSynchronousIo(thread: *mut std::ffi::c_void) -> i32;
  fn PeekNamedPipe(
    pipe: *mut std::ffi::c_void,
    buffer: *mut std::ffi::c_void,
    buffer_size: u32,
    bytes_read: *mut u32,
    bytes_available: *mut u32,
    bytes_left: *mut u32,
  ) -> i32;
}

macro_rules! capture_pipe {
  ($pipe:ty) => {
    impl CapturePipe for $pipe {
      fn prepare(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
          use std::os::fd::AsRawFd;
          let fd = self.as_raw_fd();
          // SAFETY: fd is borrowed from this owned pipe; no ownership is transferred.
          let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
          if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            return Err(io::Error::last_os_error());
          }
        }
        Ok(())
      }

      fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        #[cfg(windows)]
        {
          use std::os::windows::io::AsRawHandle;
          let mut available = 0;
          // SAFETY: the handle belongs to this pipe, the optional buffers are null and
          // available is writable. This is the sole reader of this synchronous handle.
          let ready = unsafe {
            PeekNamedPipe(
              self.as_raw_handle(),
              ptr::null_mut(),
              0,
              ptr::null_mut(),
              &mut available,
              ptr::null_mut(),
            )
          };
          if ready == 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(109) {
              // ERROR_BROKEN_PIPE: every writer closed.
              return Ok(0);
            }
            return Err(error);
          }
          if available == 0 {
            return Err(io::Error::from(io::ErrorKind::WouldBlock));
          }
          let bytes = buffer.len().min(available as usize);
          return self.read(&mut buffer[..bytes]);
        }
        #[cfg(not(windows))]
        self.read(buffer)
      }
    }
  };
}
capture_pipe!(std::process::ChildStdout);
capture_pipe!(std::process::ChildStderr);

#[derive(Default)]
struct CaptureData {
  bytes: Vec<u8>,
  total: usize,
  error: Option<(YoloStatus, String)>,
}

struct Capture {
  data: Mutex<CaptureData>,
  limit: Option<usize>,
  cancel: AtomicBool,
  finished: AtomicBool,
  changed: Arc<ProcessEvent>,
}

impl Capture {
  fn new(limit: Option<usize>, changed: Arc<ProcessEvent>) -> Self {
    Self {
      data: Mutex::new(CaptureData::default()),
      limit,
      cancel: AtomicBool::new(false),
      finished: AtomicBool::new(false),
      changed,
    }
  }

  fn fail(&self, status: YoloStatus, message: String) {
    let mut data = lock(&self.data);
    if data.error.is_none() {
      data.error = Some((status, message));
    }
  }

  fn pump(
    self: Arc<Self>,
    mut source: impl CapturePipe,
    name: &'static str,
  ) -> io::Result<JoinHandle<()>> {
    source.prepare()?;
    std::thread::Builder::new().name(format!("yolo-{name}")).spawn(move || {
      let mut chunk = [0u8; 4096];
      let mut cancelled_at = None;
      loop {
        if self.cancel.load(Ordering::Acquire) {
          let deadline = cancelled_at.get_or_insert_with(Instant::now);
          if deadline.elapsed() > Duration::from_millis(100) {
            self.fail(YoloStatus::Internal, format!("{name} did not reach EOF during shutdown"));
            break;
          }
        }
        match source.read_available(&mut chunk) {
          Ok(0) => break,
          Ok(n) => {
            let mut data = lock(&self.data);
            data.total = data.total.saturating_add(n);
            if let Some(limit) = self.limit
              && data.total > limit
            {
              if data.error.is_none() {
                data.error = Some((
                  YoloStatus::OutputLimit,
                  format!("{name} exceeded its {limit} byte capture budget"),
                ));
              }
              // Continue draining the pipe so the child cannot deadlock on its output.
              continue;
            }
            data.bytes.extend_from_slice(&chunk[..n]);
            if self.limit.is_none() && data.bytes.len() > CAPTURE_LIMIT {
              let excess = data.bytes.len() - CAPTURE_LIMIT;
              data.bytes.drain(..excess);
            }
          }
          Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
          Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            if self.cancel.load(Ordering::Acquire) && self.limit.is_none() {
              break;
            }
            // A killed descendant may still be closing its pipe. Lossless mode waits for
            // EOF within the cancellation deadline rather than reporting a transient gap.
            std::thread::sleep(Duration::from_millis(5));
          }
          Err(error) => {
            self.fail(YoloStatus::Internal, format!("cannot read {name}: {error}"));
            break;
          }
        }
      }
      self.finished.store(true, Ordering::Release);
      self.changed.wake();
    })
  }
}

#[derive(Default)]
struct ProcessEvent {
  mutex: Mutex<()>,
  changed: Condvar,
}
impl ProcessEvent {
  fn wake(&self) {
    self.changed.notify_all();
  }
  fn wait(&self) {
    // Native child status/cancellation are sampled here, never by language bindings.
    // EOF/stop/writer completion also wake the wait immediately.
    let _ = self
      .changed
      .wait_timeout(lock(&self.mutex), Duration::from_millis(10))
      .unwrap_or_else(|error| error.into_inner());
  }
}

#[derive(Default)]
struct StdinData {
  queue: VecDeque<Vec<u8>>,
  total: usize,
  written: usize,
  closing: bool,
  cancelled: bool,
  error: Option<String>,
}
struct StdinState {
  data: Mutex<StdinData>,
  ready: Condvar,
  finished: AtomicBool,
  changed: Arc<ProcessEvent>,
}

trait StdinPipe: Write + Send + 'static {
  fn prepare(&self) -> io::Result<()>;
}
impl StdinPipe for std::process::ChildStdin {
  fn prepare(&self) -> io::Result<()> {
    #[cfg(unix)]
    {
      use std::os::fd::AsRawFd;
      let fd = self.as_raw_fd();
      // SAFETY: borrowed owned pipe; non-blocking writes keep an escaped reader cancellable.
      let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
      if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
      }
    }
    Ok(())
  }
}

#[cfg(all(windows, test))]
impl StdinPipe for std::fs::File {
  fn prepare(&self) -> io::Result<()> {
    Ok(())
  }
}

impl StdinState {
  fn new(changed: Arc<ProcessEvent>) -> Self {
    Self {
      data: Mutex::new(StdinData::default()),
      ready: Condvar::new(),
      finished: AtomicBool::new(false),
      changed,
    }
  }
  fn write(&self, bytes: &[u8]) -> YoloStatus {
    let mut data = lock(&self.data);
    if data.closing || self.finished.load(Ordering::Acquire) {
      return set_error(YoloStatus::InvalidArgument, "process stdin is closed");
    }
    if bytes.len() > YOLO_STDIN_MAX_BYTES.saturating_sub(data.total) {
      return set_error(YoloStatus::InvalidArgument, "stdin exceeds its cumulative 1 MiB budget");
    }
    if !bytes.is_empty() && data.queue.len() >= 64 {
      return set_error(
        YoloStatus::Busy,
        "stdin has 64 queued chunks; retry after the writer drains",
      );
    }
    data.total += bytes.len();
    if !bytes.is_empty() {
      data.queue.push_back(bytes.to_vec());
    }
    self.ready.notify_one();
    YoloStatus::Ok
  }
  fn close(&self) {
    lock(&self.data).closing = true;
    self.ready.notify_one();
  }
  fn cancel(&self) {
    let mut data = lock(&self.data);
    data.cancelled = true;
    data.closing = true;
    data.queue.clear();
    self.ready.notify_one();
  }
  fn pump(self: Arc<Self>, mut pipe: impl StdinPipe) -> io::Result<JoinHandle<()>> {
    pipe.prepare()?;
    std::thread::Builder::new().name("yolo-stdin".into()).spawn(move || {
      'queue: loop {
        let bytes = {
          let mut data = lock(&self.data);
          while data.queue.is_empty() && !data.closing {
            data = self.ready.wait(data).unwrap_or_else(|error| error.into_inner());
          }
          if data.cancelled {
            break;
          }
          match data.queue.pop_front() {
            Some(bytes) => bytes,
            None => break,
          }
        };
        let mut offset = 0;
        while offset < bytes.len() {
          if lock(&self.data).cancelled {
            break 'queue;
          }
          match pipe.write(&bytes[offset..bytes.len().min(offset + 4096)]) {
            Ok(0) => {
              let mut data = lock(&self.data);
              data.error = Some("process stdin stopped accepting bytes".into());
              data.closing = true;
              data.queue.clear();
              break 'queue;
            }
            Ok(written) => {
              offset += written;
              lock(&self.data).written += written;
              self.changed.wake();
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
              let data = lock(&self.data);
              if data.cancelled {
                break 'queue;
              }
              let _ = self
                .ready
                .wait_timeout(data, Duration::from_millis(10))
                .unwrap_or_else(|error| error.into_inner());
            }
            Err(error) => {
              let mut data = lock(&self.data);
              if !data.cancelled {
                data.error = Some(format!("cannot write process stdin: {error}"));
              }
              data.closing = true;
              data.queue.clear();
              break 'queue;
            }
          }
        }
      }
      drop(pipe); // EOF occurs only after accepted data drained or ownership cancelled.
      self.finished.store(true, Ordering::Release);
      self.changed.wake();
    })
  }
}

/// The process tree of a Windows child: a Job Object with `KILL_ON_JOB_CLOSE`, so descendants
/// die with the child even when the runtime is torn down without a stop. A child that spawns
/// before `AssignProcessToJobObject` returns can leave a grandchild outside the job; nothing
/// else escapes because breakaway is not allowed.
#[cfg(windows)]
mod tree {
  use std::ffi::c_void;
  use std::os::windows::io::AsRawHandle;
  use std::process::Child;

  type Handle = *mut c_void;
  const BASIC_ACCOUNTING_INFORMATION: i32 = 1;
  const EXTENDED_LIMIT_INFORMATION: i32 = 9;
  const LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

  #[repr(C)]
  #[derive(Default)]
  struct ExtendedLimitInformation {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
    io_counters: [u64; 6],
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
  }

  #[repr(C)]
  #[derive(Default)]
  struct BasicAccountingInformation {
    times: [i64; 4],
    total_page_fault_count: u32,
    total_processes: u32,
    active_processes: u32,
    total_terminated_processes: u32,
  }

  #[link(name = "kernel32")]
  unsafe extern "system" {
    fn CreateJobObjectW(security: *const c_void, name: *const u16) -> Handle;
    fn SetInformationJobObject(job: Handle, class: i32, info: *const c_void, len: u32) -> i32;
    fn QueryInformationJobObject(
      job: Handle,
      class: i32,
      info: *mut c_void,
      len: u32,
      ret: *mut u32,
    ) -> i32;
    fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
    fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
    fn CloseHandle(handle: Handle) -> i32;
  }

  pub(crate) struct ProcessTree(Handle);

  // SAFETY: a job handle is a kernel object reference usable from any thread.
  unsafe impl Send for ProcessTree {}
  // SAFETY: as above; every call on it is a thread-safe kernel call.
  unsafe impl Sync for ProcessTree {}

  impl ProcessTree {
    /// `None` when the job cannot be created or the child cannot join it (for example a
    /// parent job that forbids nesting); the child is then stopped on its own.
    pub(crate) fn adopt(child: &Child) -> Option<ProcessTree> {
      // SAFETY: anonymous job with default security.
      let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
      if job.is_null() {
        return None;
      }
      let tree = ProcessTree(job);
      let info =
        ExtendedLimitInformation { limit_flags: LIMIT_KILL_ON_JOB_CLOSE, ..Default::default() };
      // SAFETY: `info` is a JOBOBJECT_EXTENDED_LIMIT_INFORMATION of the stated size.
      let limited = unsafe {
        SetInformationJobObject(
          job,
          EXTENDED_LIMIT_INFORMATION,
          (&raw const info).cast(),
          size_of::<ExtendedLimitInformation>() as u32,
        )
      };
      // SAFETY: the child handle is owned by `child` and stays open for this call.
      if limited == 0 || unsafe { AssignProcessToJobObject(job, child.as_raw_handle()) } == 0 {
        return None;
      }
      Some(tree)
    }

    pub(crate) fn alive(&self) -> bool {
      self.active() > 0
    }

    /// Processes currently in the job.
    pub(crate) fn active(&self) -> u32 {
      let mut info = BasicAccountingInformation::default();
      // SAFETY: `info` is writable and of the stated size.
      let ok = unsafe {
        QueryInformationJobObject(
          self.0,
          BASIC_ACCOUNTING_INFORMATION,
          (&raw mut info).cast(),
          size_of::<BasicAccountingInformation>() as u32,
          std::ptr::null_mut(),
        )
      };
      if ok != 0 { info.active_processes } else { 0 }
    }

    pub(crate) fn terminate(&self) {
      // SAFETY: owned job handle; exit code 1 like `Child::kill`.
      unsafe { TerminateJobObject(self.0, 1) };
    }
  }

  impl Drop for ProcessTree {
    fn drop(&mut self) {
      // SAFETY: owned job handle, closed once.
      unsafe { CloseHandle(self.0) };
    }
  }
}

pub(crate) struct ProcState {
  pid: u32,
  #[cfg(windows)]
  tree: Option<tree::ProcessTree>,
  child: Mutex<Child>,
  exit: Mutex<Option<ExitInfo>>,
  stdout: Arc<Capture>,
  stderr: Arc<Capture>,
  readers: Mutex<Vec<JoinHandle<()>>>,
  stopped: Mutex<bool>,
  stdin: Option<Arc<StdinState>>,
  writer: Mutex<Option<JoinHandle<()>>>,
  changed: Arc<ProcessEvent>,
  waiting: AtomicBool,
}

impl ProcState {
  /// Processes in the Windows job of this child (0 without a job).
  #[cfg(all(windows, test))]
  pub(crate) fn tree_active(&self) -> u32 {
    self.tree.as_ref().map_or(0, tree::ProcessTree::active)
  }

  fn poll(&self) -> Option<ExitInfo> {
    if let Some(info) = *lock(&self.exit) {
      return Some(info);
    }
    let status = lock(&self.child).try_wait().ok().flatten()?;
    #[cfg(unix)]
    let signal = std::os::unix::process::ExitStatusExt::signal(&status);
    #[cfg(not(unix))]
    let signal = None;
    let info = ExitInfo { code: status.code(), signal };
    *lock(&self.exit) = Some(info);
    self.changed.wake();
    Some(info)
  }

  #[cfg(unix)]
  fn group_alive(&self) -> bool {
    // SAFETY: signal 0 only queries the process group we created at spawn.
    unsafe { libc::kill(-(self.pid as i32), 0) == 0 }
  }

  /// Stops the owned group even when its leader already exited, then joins every pipe reader.
  pub(crate) fn stop(&self, grace_ms: u32) {
    let mut stopped = lock(&self.stopped);
    if *stopped {
      return;
    }
    if let Some(stdin) = &self.stdin {
      stdin.cancel();
    }
    #[cfg(unix)]
    {
      if self.group_alive() {
        // SAFETY: this process group was created with process_group(0).
        unsafe { libc::kill(-(self.pid as i32), libc::SIGTERM) };
        let deadline = Instant::now() + Duration::from_millis(u64::from(grace_ms));
        while Instant::now() < deadline {
          self.poll(); // Reap the leader before querying whether its group is empty.
          if !self.group_alive() {
            break;
          }
          std::thread::sleep(Duration::from_millis(10));
        }
        if self.group_alive() {
          // SAFETY: same owned group; descendants must die even if the leader exited first.
          unsafe { libc::kill(-(self.pid as i32), libc::SIGKILL) };
        }
      }
    }
    #[cfg(windows)]
    {
      // No SIGTERM equivalent reaches an arbitrary child; the grace period bounds the wait
      // for the job to empty after it is terminated.
      match &self.tree {
        Some(tree) if tree.alive() => {
          tree.terminate();
          let deadline = Instant::now() + Duration::from_millis(u64::from(grace_ms.max(100)));
          while tree.alive() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
          }
        }
        Some(_) => {}
        None => {
          if self.poll().is_none() {
            let _ = lock(&self.child).kill();
          }
        }
      }
    }
    #[cfg(not(any(unix, windows)))]
    {
      let _ = grace_ms;
      if self.poll().is_none() {
        let _ = lock(&self.child).kill();
      }
    }
    if self.poll().is_none() {
      let _ = lock(&self.child).wait();
    }
    self.poll();
    if let Some(writer) = lock(&self.writer).take() {
      #[cfg(windows)]
      cancel_writer_io(&writer, self.stdin.as_ref().expect("owned stdin writer"));
      if writer.join().is_err() {
        if let Some(stdin) = &self.stdin {
          lock(&stdin.data).error = Some("stdin worker panicked".into());
        }
      }
    }
    // A child may have passed its pipe to an escaped descendant. Cancellation prevents that
    // pipe from retaining a native worker forever; lossless readers report incomplete output.
    self.stdout.cancel.store(true, Ordering::Release);
    self.stderr.cancel.store(true, Ordering::Release);
    for reader in lock(&self.readers).drain(..) {
      if reader.join().is_err() {
        self.stdout.fail(YoloStatus::Panic, "capture worker panicked".to_string());
        self.stderr.fail(YoloStatus::Panic, "capture worker panicked".to_string());
      }
    }
    *stopped = true;
    self.changed.wake();
  }
}

#[cfg(windows)]
fn cancel_writer_io(writer: &JoinHandle<()>, stdin: &StdinState) {
  use std::os::windows::io::AsRawHandle;
  // The thread performs only this owned pipe's writes. Recheck until completion to cover
  // cancellation between the flag check and WriteFile (ERROR_NOT_FOUND is that normal race).
  // NPFS synchronous writes are cancellable even if an escaped process retained the read end.
  while !writer.is_finished() {
    // SAFETY: the JoinHandle keeps the native thread handle alive, with THREAD_TERMINATE access.
    unsafe { CancelSynchronousIo(writer.as_raw_handle()) };
    stdin.changed.wait();
  }
}

#[cfg(all(windows, test))]
mod stdin_pipe_tests {
  use super::*;
  use std::os::windows::io::FromRawHandle;

  #[link(name = "kernel32")]
  unsafe extern "system" {
    fn CreatePipe(
      read: *mut *mut std::ffi::c_void,
      write: *mut *mut std::ffi::c_void,
      attributes: *const std::ffi::c_void,
      bytes: u32,
    ) -> i32;
  }

  #[test]
  fn cancelled_stdin_writer_joins_even_when_read_handle_remains_open() {
    let (mut read, mut write) = (ptr::null_mut(), ptr::null_mut());
    // SAFETY: writable output handles; default security and a private 4096-byte pipe.
    assert_ne!(unsafe { CreatePipe(&mut read, &mut write, ptr::null(), 4096) }, 0);
    // SAFETY: ownership of each successful pipe handle transfers exactly once.
    let reader = unsafe { std::fs::File::from_raw_handle(read) };
    let pipe = unsafe { std::fs::File::from_raw_handle(write) };
    let state = Arc::new(StdinState::new(Arc::new(ProcessEvent::default())));
    let bytes = vec![0; YOLO_STDIN_MAX_BYTES];
    assert_eq!(state.write(&bytes), YoloStatus::Ok);
    let writer = state.clone().pump(pipe).unwrap();
    let deadline = Instant::now() + Duration::from_secs(1);
    while lock(&state.data).written == 0 && Instant::now() < deadline {
      state.changed.wait();
    }
    assert!(lock(&state.data).written > 0);
    let started = Instant::now();
    state.cancel();
    cancel_writer_io(&writer, &state);
    writer.join().unwrap();
    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(state.finished.load(Ordering::Acquire));
    assert!(lock(&state.data).written < bytes.len());
    // Reader was deliberately held until after the writer joined; EOF could not unblock it.
    drop(reader);
  }
}

fn read_c_string(ptr: *const c_char, what: &str) -> Result<String, YoloStatus> {
  if ptr.is_null() {
    return Err(set_error(YoloStatus::InvalidArgument, format!("{what} is null")));
  }
  // SAFETY: the caller guarantees NUL-terminated strings.
  unsafe { CStr::from_ptr(ptr) }
    .to_str()
    .map(str::to_owned)
    .map_err(|_| set_error(YoloStatus::InvalidArgument, format!("{what} is not valid UTF-8")))
}

fn read_c_array(mut array: *const *const c_char, what: &str) -> Result<Vec<String>, YoloStatus> {
  let mut out = Vec::new();
  if array.is_null() {
    return Ok(out);
  }
  loop {
    // SAFETY: the array is NULL-terminated per the contract.
    let item = unsafe { *array };
    if item.is_null() {
      return Ok(out);
    }
    out.push(read_c_string(item, what)?);
    // SAFETY: the previous element was not the terminator.
    array = unsafe { array.add(1) };
  }
}

/// Spawns a process owned by the runtime. The child runs in its own process group so that stopping
/// it also stops its descendants. Counts against `max_operations` like an operation.
///
/// # Safety
/// `info` must point to a readable `YoloSpawnInfo` with valid strings, `out` to a writable handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_spawn(
  runtime: YoloHandle,
  info: *const YoloSpawnInfo,
  out: *mut YoloHandle,
) -> YoloStatus {
  guard(|| {
    if info.is_null() || out.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null argument");
    }
    // SAFETY: readable per the contract; the first field is read before trusting the size.
    let struct_size = unsafe { ptr::addr_of!((*info).struct_size).read_unaligned() };
    if (struct_size as usize) < size_of::<YoloSpawnInfo>() {
      return set_error(YoloStatus::InvalidArgument, "struct_size too small");
    }
    // SAFETY: the structure is fully readable.
    // ABI 1.0-1.3 callers supply the original 40-byte structure. ABI 1.4 may append a
    // per-stream lossless budget; zero selects the default.
    let capture_limit = if struct_size as usize >= size_of::<YoloSpawnInfo>() + size_of::<u64>() {
      // SAFETY: struct_size includes this appended u64, and the caller promises readable storage.
      unsafe { info.cast::<u8>().add(size_of::<YoloSpawnInfo>()).cast::<u64>().read_unaligned() }
    } else {
      0
    };
    let info = unsafe { info.read_unaligned() };
    if info.flags
      & !(YOLO_SPAWN_NULL_STDIO
        | YOLO_SPAWN_CAPTURE
        | YOLO_SPAWN_CAPTURE_LOSSLESS
        | YOLO_SPAWN_PIPE_STDIN)
      != 0
    {
      return set_error(YoloStatus::InvalidArgument, "unknown spawn flags");
    }
    if capture_limit > YOLO_CAPTURE_MAX_BYTES as u64 {
      return set_error(YoloStatus::InvalidArgument, "capture budget exceeds 64 MiB");
    }
    let lossless = info.flags & YOLO_SPAWN_CAPTURE_LOSSLESS != 0;
    if lossless && info.flags & (YOLO_SPAWN_NULL_STDIO | YOLO_SPAWN_CAPTURE) != 0 {
      return set_error(
        YoloStatus::InvalidArgument,
        "LOSSLESS, CAPTURE and NULL_STDIO are exclusive",
      );
    }
    if !lossless && capture_limit != 0 {
      return set_error(YoloStatus::InvalidArgument, "capture budget requires lossless capture");
    }
    let program = match read_c_string(info.program, "program") {
      Ok(p) => p,
      Err(status) => return status,
    };
    let args = match read_c_array(info.args, "argument") {
      Ok(a) => a,
      Err(status) => return status,
    };
    let env = match read_c_array(info.env, "environment entry") {
      Ok(e) => e,
      Err(status) => return status,
    };
    let cwd = if info.cwd.is_null() {
      None
    } else {
      match read_c_string(info.cwd, "cwd") {
        Ok(c) => Some(c),
        Err(status) => return status,
      }
    };

    let mut command = Command::new(&program);
    command.args(&args);
    for entry in &env {
      match entry.split_once('=') {
        Some((key, value)) if !key.is_empty() => command.env(key, value),
        // `KEY` alone removes the variable from the inherited environment.
        None if !entry.is_empty() => command.env_remove(entry),
        _ => {
          return set_error(
            YoloStatus::InvalidArgument,
            "environment entries are KEY=VALUE, or KEY to remove the variable",
          );
        }
      };
    }
    if let Some(cwd) = &cwd {
      command.current_dir(cwd);
    }
    let null_stdio = info.flags & YOLO_SPAWN_NULL_STDIO != 0;
    let piped_stdin = info.flags & YOLO_SPAWN_PIPE_STDIN != 0;
    let capture = info.flags & (YOLO_SPAWN_CAPTURE | YOLO_SPAWN_CAPTURE_LOSSLESS) != 0;
    if null_stdio && capture {
      return set_error(YoloStatus::InvalidArgument, "NULL_STDIO and CAPTURE are exclusive");
    }
    if null_stdio && piped_stdin {
      return set_error(YoloStatus::InvalidArgument, "NULL_STDIO and PIPE_STDIN are exclusive");
    }
    if null_stdio {
      command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    } else if capture {
      command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    }
    if piped_stdin {
      command.stdin(Stdio::piped());
    }
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      command.creation_flags(0x08000000); // CREATE_NO_WINDOW for native owned workers.
    }
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);

    let mut reg = lock(registry());
    let limit = match runtime_limit(&reg, runtime) {
      Ok(limit) => limit,
      Err(status) => return status,
    };
    if reg.capacity_used_by(runtime) as u32 >= limit {
      return set_error(YoloStatus::Busy, format!("{limit} operations already running"));
    }
    let mut child = match command.spawn() {
      Ok(child) => child,
      Err(error) => {
        return set_error(YoloStatus::Internal, format!("cannot spawn `{program}`: {error}"));
      }
    };
    let limit = lossless.then_some(if capture_limit == 0 {
      YOLO_CAPTURE_MAX_BYTES
    } else {
      capture_limit as usize
    });
    let changed = Arc::new(ProcessEvent::default());
    let stdout = Arc::new(Capture::new(limit, changed.clone()));
    let stderr = Arc::new(Capture::new(limit, changed.clone()));
    let stdin_pipe = child.stdin.take();
    let stdin = piped_stdin.then(|| Arc::new(StdinState::new(changed.clone())));
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let state = Arc::new(ProcState {
      pid: child.id(),
      #[cfg(windows)]
      tree: tree::ProcessTree::adopt(&child),
      child: Mutex::new(child),
      exit: Mutex::new(None),
      stdout,
      stderr,
      readers: Mutex::new(Vec::new()),
      stopped: Mutex::new(false),
      stdin,
      writer: Mutex::new(None),
      changed,
      waiting: AtomicBool::new(false),
    });
    #[cfg(windows)]
    if piped_stdin && state.tree.is_none() {
      drop(reg);
      state.stop(0);
      return set_error(
        YoloStatus::Internal,
        "owned stdin requires successful Windows Job adoption",
      );
    }
    let started = (|| -> io::Result<()> {
      if let Some(pipe) = stdin_pipe {
        *lock(&state.writer) =
          Some(Arc::clone(state.stdin.as_ref().expect("owned stdin pipe")).pump(pipe)?);
      }
      if let Some(pipe) = stdout_pipe {
        lock(&state.readers).push(Arc::clone(&state.stdout).pump(pipe, "stdout")?);
      } else {
        state.stdout.finished.store(true, Ordering::Release);
      }
      if let Some(pipe) = stderr_pipe {
        lock(&state.readers).push(Arc::clone(&state.stderr).pump(pipe, "stderr")?);
      } else {
        state.stderr.finished.store(true, Ordering::Release);
      }
      Ok(())
    })();
    if let Err(error) = started {
      // No reader accesses the registry, but drop its lock before potentially waiting on workers.
      drop(reg);
      state.stop(0);
      return set_error(YoloStatus::Internal, format!("cannot start capture worker: {error}"));
    }
    let handle = reg.insert(Entry::Process { owner: runtime, state });
    drop(reg);
    // SAFETY: `out` is writable per the contract.
    unsafe { out.write(handle) };
    YoloStatus::Ok
  })
}

fn process_state(process: YoloHandle) -> Result<Arc<ProcState>, YoloStatus> {
  match lock(registry()).get(process) {
    Some(Entry::Process { state, .. }) => Ok(Arc::clone(state)),
    _ => Err(set_error(YoloStatus::InvalidHandle, "invalid process handle")),
  }
}

/// ABI 1.6: copies bytes into the owned writer's bounded queue and returns without pipe I/O.
/// Accepted bytes are written in order. A cumulative 1 MiB budget and 64 queued chunks bound memory.
/// Errors in the writer are reported by process.wait; writes after close are invalid.
///
/// # Safety
/// `bytes` must point to `len` readable bytes, or may be NULL when len is zero.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_stdin_write(
  process: YoloHandle,
  bytes: *const u8,
  len: usize,
) -> YoloStatus {
  guard(|| {
    if len > YOLO_STDIN_MAX_BYTES || (len != 0 && bytes.is_null()) {
      return set_error(YoloStatus::InvalidArgument, "stdin must be readable bytes within 1 MiB");
    }
    let state = match process_state(process) {
      Ok(state) => state,
      Err(status) => return status,
    };
    let Some(stdin) = &state.stdin else {
      return set_error(YoloStatus::InvalidArgument, "process was not spawned with PIPE_STDIN");
    };
    // SAFETY: readable per the contract; the empty case avoids a null Rust slice.
    let bytes = if len == 0 { &[] } else { unsafe { std::slice::from_raw_parts(bytes, len) } };
    stdin.write(bytes)
  })
}

/// ABI 1.6: closes stdin after queued data drains. Repeated close succeeds.
#[unsafe(no_mangle)]
pub extern "C" fn yolo_process_stdin_close(process: YoloHandle) -> YoloStatus {
  guard(|| {
    let state = match process_state(process) {
      Ok(state) => state,
      Err(status) => return status,
    };
    let Some(stdin) = &state.stdin else {
      return set_error(YoloStatus::InvalidArgument, "process was not spawned with PIPE_STDIN");
    };
    stdin.close();
    YoloStatus::Ok
  })
}

struct WaitLease(Arc<ProcState>);
impl Drop for WaitLease {
  fn drop(&mut self) {
    self.0.waiting.store(false, Ordering::Release);
    self.0.changed.wake();
  }
}

/// ABI 1.6: waits on the existing process owner until child exit and both capture EOFs.
/// One wait per process is permitted; it does not consume another process slot. Cancelling this
/// operation stops the owned tree. Operation.wait timeout alone leaves the operation running.
///
/// # Safety
/// `out_operation` must point to a writable handle. No caller memory is retained by the worker.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_wait_start(
  process: YoloHandle,
  out_operation: *mut YoloHandle,
) -> YoloStatus {
  guard(|| {
    if out_operation.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null output handle");
    }
    let (owner, state) = match lock(registry()).get(process) {
      Some(Entry::Process { owner, state }) => (*owner, Arc::clone(state)),
      _ => return set_error(YoloStatus::InvalidHandle, "invalid process handle"),
    };
    if state.waiting.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
      return set_error(YoloStatus::Busy, "process already has an active wait");
    }
    let lease = WaitLease(state);
    let started = start_operation(owner, "process-wait", false, move |cancel| {
      let state = &lease.0;
      loop {
        if cancel.load(Ordering::Acquire) {
          state.stop(DESTROY_GRACE_MS);
          return OpResult::Cancelled;
        }
        if state.poll().is_some() {
          break;
        }
        state.changed.wait();
      }
      // The child may have left descendants with inherited pipes. Stop that owned tree and
      // join the readers before publishing the final result; never expose a partial envelope.
      state.stop(0);
      if cancel.load(Ordering::Acquire) {
        return OpResult::Cancelled;
      }
      for capture in [&state.stdout, &state.stderr] {
        if let Some((status, message)) = &lock(&capture.data).error {
          return OpResult::Status(*status, message.clone());
        }
      }
      if let Some(stdin) = &state.stdin {
        let data = lock(&stdin.data);
        if let Some(message) = &data.error {
          return OpResult::Failed(message.clone());
        }
        if data.written != data.total {
          return OpResult::Failed(
            "process exited before all queued stdin bytes were written".into(),
          );
        }
      }
      let Some(exit) = state.poll() else {
        return OpResult::Failed("process exit was not observed".into());
      };
      OpResult::Done(serde_json::json!({
        "state": 1, "pid": state.pid, "exit_code": exit.code.unwrap_or(-1),
        "signal": exit.signal.unwrap_or(0), "output_complete": true,
        "stdin_complete": state.stdin.as_ref().is_none_or(|stdin| stdin.finished.load(Ordering::Acquire)),
      }).to_string())
    });
    match started {
      Ok(handle) => {
        // SAFETY: writable per the contract.
        unsafe { out_operation.write(handle) };
        YoloStatus::Ok
      }
      Err(status) => status,
    }
  })
}

/// Non-blocking status of the process.
///
/// # Safety
/// `out` must point to a writable `YoloProcessStatus` whose `struct_size` is set by the caller.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_status(
  process: YoloHandle,
  out: *mut YoloProcessStatus,
) -> YoloStatus {
  guard(|| {
    if out.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null output");
    }
    let state = match process_state(process) {
      Ok(state) => state,
      Err(status) => return status,
    };
    let exit = state.poll();
    let status = YoloProcessStatus {
      struct_size: size_of::<YoloProcessStatus>() as u32,
      state: u32::from(exit.is_some()),
      exit_code: exit.map_or(0, |e| e.code.unwrap_or(-1)),
      signal: exit.and_then(|e| e.signal).unwrap_or(0),
      pid: state.pid,
    };
    // SAFETY: `out` is writable per the contract.
    unsafe { out.write(status) };
    YoloStatus::Ok
  })
}

/// Reads the captured output of a process spawned with `YOLO_SPAWN_CAPTURE`: `stream` is
/// `YOLO_STREAM_STDOUT` or `YOLO_STREAM_STDERR`, `mode` is `YOLO_READ_DRAIN` or `YOLO_READ_PEEK`.
/// The bytes are returned in a library-owned buffer (possibly empty).
///
/// # Safety
/// `out` must point to a writable `YoloBuffer`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_read(
  process: YoloHandle,
  stream: u32,
  mode: u32,
  out: *mut YoloBuffer,
) -> YoloStatus {
  guard(|| {
    if out.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null output buffer");
    }
    let state = match process_state(process) {
      Ok(state) => state,
      Err(status) => return status,
    };
    let capture = match stream {
      YOLO_STREAM_STDOUT => &state.stdout,
      YOLO_STREAM_STDERR => &state.stderr,
      _ => return set_error(YoloStatus::InvalidArgument, "unknown stream"),
    };
    let bytes = {
      let mut data = lock(&capture.data);
      if let Some((status, message)) = &data.error {
        return set_error(*status, message);
      }
      match mode {
        YOLO_READ_DRAIN => std::mem::take(&mut data.bytes),
        YOLO_READ_PEEK => data.bytes.clone(),
        _ => return set_error(YoloStatus::InvalidArgument, "unknown read mode"),
      }
    };
    write_buffer(out, bytes)
  })
}

/// ABI 1.4: returns 1 after both capture readers finish, 0 while either can still produce bytes.
/// Completion does not imply success; yolo_process_read reports output limits and I/O failures.
///
/// # Safety
/// out must point to a writable u32.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_output_complete(
  process: YoloHandle,
  out: *mut u32,
) -> YoloStatus {
  guard(|| {
    if out.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null output");
    }
    let state = match process_state(process) {
      Ok(state) => state,
      Err(status) => return status,
    };
    let complete = state.stdout.finished.load(Ordering::Acquire)
      && state.stderr.finished.load(Ordering::Acquire);
    // SAFETY: out is writable per the contract.
    unsafe { out.write(u32::from(complete)) };
    YoloStatus::Ok
  })
}

/// Stops the process (SIGTERM to its group, SIGKILL after `grace_ms`) and waits for it. The handle
/// stays valid so the exit status can still be read.
#[unsafe(no_mangle)]
pub extern "C" fn yolo_process_stop(process: YoloHandle, grace_ms: u32) -> YoloStatus {
  guard(|| match process_state(process) {
    Ok(state) => {
      state.stop(grace_ms);
      YoloStatus::Ok
    }
    Err(status) => status,
  })
}

/// Asynchronous `yolo_process_stop`: the SIGTERM/grace/SIGKILL sequence runs on a worker thread and
/// the operation (not counted against `max_operations`) yields `{"exit_code": n, "signal": n}`.
///
/// # Safety
/// `out_operation` must point to a writable `YoloHandle`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_stop_start(
  process: YoloHandle,
  grace_ms: u32,
  out_operation: *mut YoloHandle,
) -> YoloStatus {
  guard(|| {
    if out_operation.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null output handle");
    }
    let (owner, state) = match lock(registry()).get(process) {
      Some(Entry::Process { owner, state }) => (*owner, Arc::clone(state)),
      _ => return set_error(YoloStatus::InvalidHandle, "invalid process handle"),
    };
    let started = start_operation(owner, "stop", false, move |_| {
      state.stop(grace_ms);
      let exit = state.poll();
      OpResult::Done(
        serde_json::json!({
          "exit_code": exit.map_or(0, |e| e.code.unwrap_or(-1)),
          "signal": exit.and_then(|e| e.signal).unwrap_or(0),
        })
        .to_string(),
      )
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

/// Stops the process if it is still running (2 s grace) and invalidates the handle.
#[unsafe(no_mangle)]
pub extern "C" fn yolo_process_release(process: YoloHandle) -> YoloStatus {
  guard(|| {
    let entry = {
      let mut reg = lock(registry());
      match reg.get(process) {
        Some(Entry::Process { .. }) => reg.remove(process),
        _ => None,
      }
    };
    match entry {
      Some(Entry::Process { state, .. }) => {
        state.stop(RELEASE_GRACE_MS);
        YoloStatus::Ok
      }
      _ => set_error(YoloStatus::InvalidHandle, "invalid process handle"),
    }
  })
}

/// One HTTP/1.0 `GET` with connect/read timeouts. `Ok(status)` when the server answers, `Err(why)`
/// when it is not reachable (yet).
fn probe_blocking(host: &str, port: u16, path: &str, timeout: Duration) -> Result<i32, String> {
  let addrs =
    (host, port).to_socket_addrs().map_err(|error| format!("cannot resolve {host}: {error}"))?;
  let mut last = "no address".to_string();
  for addr in addrs {
    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
      Ok(stream) => stream,
      Err(error) => {
        last = error.to_string();
        continue;
      }
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!(
      "GET {path} HTTP/1.0\r\nHost: {host}:{port}\r\nUser-Agent: yolo-runtime/{}\r\nAccept: */*\r\nConnection: close\r\n\r\n",
      env!("CARGO_PKG_VERSION")
    );
    if let Err(error) = stream.write_all(request.as_bytes()) {
      last = error.to_string();
      continue;
    }
    let mut head = [0u8; 32];
    let mut filled = 0;
    let mut read_failure = None;
    while filled < head.len() {
      match stream.read(&mut head[filled..]) {
        Ok(0) => break,
        Ok(n) => filled += n,
        Err(error) => {
          read_failure = Some(error.to_string());
          break;
        }
      }
      if head[..filled].contains(&b'\r') || head[..filled].contains(&b'\n') {
        break;
      }
    }
    let line = String::from_utf8_lossy(&head[..filled]);
    let code = line
      .strip_prefix("HTTP/1.")
      .and_then(|rest| rest.get(2..5))
      .and_then(|code| code.parse::<i32>().ok());
    match code {
      Some(code) => return Ok(code),
      None => {
        last = read_failure.unwrap_or_else(|| format!("not an HTTP response: {line:?}"));
      }
    }
  }
  Err(last)
}

/// `http.probe`: starts one HTTP/1.0 `GET` on a worker thread and returns an operation handle, so
/// the caller never blocks. `yolo_operation_wait` yields the JSON `{"status": <code>}` when the
/// server answered and `{"status": null, "error": "<why>"}` when it is not reachable (yet).
///
/// # Safety
/// `host` and `path` must be NUL-terminated UTF-8; `out_operation` must be writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_http_probe_start(
  runtime: YoloHandle,
  host: *const c_char,
  port: u16,
  path: *const c_char,
  timeout_ms: u32,
  out_operation: *mut YoloHandle,
) -> YoloStatus {
  guard(|| {
    if out_operation.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null output handle");
    }
    let host = match read_c_string(host, "host") {
      Ok(h) if !h.contains(['\r', '\n', ' ']) => h,
      Ok(_) => return set_error(YoloStatus::InvalidArgument, "invalid host"),
      Err(status) => return status,
    };
    let path = match read_c_string(path, "path") {
      Ok(p) if p.starts_with('/') && !p.contains(['\r', '\n', ' ']) => p,
      Ok(_) => {
        return set_error(
          YoloStatus::InvalidArgument,
          "path must start with / and contain no whitespace",
        );
      }
      Err(status) => return status,
    };
    let timeout = Duration::from_millis(u64::from(timeout_ms.max(1)));
    let started = start_operation(runtime, "probe", true, move |cancel| {
      if cancel.load(Ordering::Relaxed) {
        return OpResult::Cancelled;
      }
      let value = match probe_blocking(&host, port, &path, timeout) {
        Ok(status) => serde_json::json!({ "status": status }),
        Err(error) => serde_json::json!({ "status": null, "error": error }),
      };
      OpResult::Done(value.to_string())
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
