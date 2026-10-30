// A Windows job object that kills its processes when the last handle closes, through bun:ffi (kernel32).
// Upstream Bun has no job-object API; this is the whole of what the process owner needs.
import { dlopen, FFIType, ptr } from "bun:ffi";

const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JobObjectExtendedLimitInformation = 9;
/** sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION) on 64-bit Windows; LimitFlags sits at offset 16. */
const EXTENDED_LIMIT_SIZE = 144;

type Kernel32 = ReturnType<typeof load>["symbols"];

function load() {
  return dlopen("kernel32.dll", {
    CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    SetInformationJobObject: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.bool },
    OpenProcess: { args: [FFIType.u32, FFIType.bool, FFIType.u32], returns: FFIType.ptr },
    AssignProcessToJobObject: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
    TerminateJobObject: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.bool },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.bool },
    GetLastError: { args: [], returns: FFIType.u32 },
  });
}

let kernel32: Kernel32 | undefined;

/** An anonymous job object; closing it (or exiting this process) terminates every assigned process. */
export class WindowsJob {
  #handle: bigint | undefined;
  readonly #k: Kernel32;

  constructor(options: { killOnClose: boolean }) {
    if (process.platform !== "win32") throw new Error("Windows job objects exist only on Windows");
    kernel32 ??= load().symbols;
    this.#k = kernel32;
    const handle = this.#k.CreateJobObjectW(null, null);
    if (!handle) throw new Error(`CreateJobObjectW failed: ${this.#k.GetLastError()}`);
    this.#handle = BigInt(handle);
    if (options.killOnClose) {
      const info = new Uint8Array(EXTENDED_LIMIT_SIZE);
      new DataView(info.buffer).setUint32(16, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, true);
      if (!this.#k.SetInformationJobObject(this.#handle, JobObjectExtendedLimitInformation, ptr(info), info.length)) {
        const code = this.#k.GetLastError();
        this.close();
        throw new Error(`SetInformationJobObject failed: ${code}`);
      }
    }
  }

  assign(process: { pid: number }): void {
    if (this.#handle === undefined) throw new Error("job is closed");
    const child = this.#k.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, process.pid);
    if (!child) throw new Error(`OpenProcess(${process.pid}) failed: ${this.#k.GetLastError()}`);
    try {
      if (!this.#k.AssignProcessToJobObject(this.#handle, child)) {
        throw new Error(`AssignProcessToJobObject failed: ${this.#k.GetLastError()}`);
      }
    } finally {
      this.#k.CloseHandle(child);
    }
  }

  terminate(code = 1): void {
    if (this.#handle !== undefined) this.#k.TerminateJobObject(this.#handle, code);
  }

  close(): void {
    if (this.#handle === undefined) return;
    this.#k.CloseHandle(this.#handle);
    this.#handle = undefined;
  }
}
