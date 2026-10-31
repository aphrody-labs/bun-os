//! Bun -> JVM bridge: the JNI invocation API (`JNI_CreateJavaVM` from `libjvm`) behind a C ABI for `bun:ffi`.
//!
//! One JVM per process (a JVM cannot be recreated after destruction). Strings cross the boundary as NUL-terminated
//! UTF-8; every returned string is owned by the caller and released with [`bunos_jvm_free`]. Failures return a
//! negative status or a null pointer, and [`bunos_jvm_last_error`] describes the last failure of the calling thread
//! (Java exceptions included). Consumed by `packages/bun-android/src/jvm.ts`.

use std::cell::RefCell;
use std::ffi::{CStr, CString, c_char};
use std::sync::OnceLock;

use jni::objects::{JString, JValue};
use jni::signature::{MethodSignature, RuntimeMethodSignature};
use jni::strings::JNIString;
use jni::{InitArgsBuilder, JNIVersion, JavaVM};

static VM: OnceLock<JavaVM> = OnceLock::new();

thread_local! {
    static LAST_ERROR: RefCell<Option<CString>> = const { RefCell::new(None) };
}

fn fail(message: impl Into<String>) {
    let text = message.into().replace('\0', " ");
    LAST_ERROR.with(|slot| *slot.borrow_mut() = CString::new(text).ok());
}

/// Read an optional C string argument.
///
/// # Safety
/// `ptr` is null or a valid NUL-terminated string that outlives the call.
unsafe fn arg<'a>(ptr: *const c_char) -> Option<&'a str> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: guaranteed by the caller.
    unsafe { CStr::from_ptr(ptr) }.to_str().ok()
}

fn owned(text: String) -> *mut c_char {
    CString::new(text.replace('\0', " ")).map_or(std::ptr::null_mut(), CString::into_raw)
}

fn vm() -> Result<&'static JavaVM, String> {
    VM.get().ok_or_else(|| "JVM not started: call bunos_jvm_start first".to_owned())
}

fn start(libjvm: Option<&str>, options: &str) -> Result<(), String> {
    if VM.get().is_some() {
        return Ok(());
    }
    let mut builder = InitArgsBuilder::new().version(JNIVersion::V1_8);
    for option in options.lines().map(str::trim).filter(|line| !line.is_empty()) {
        builder = builder.option(option.to_owned());
    }
    let args = builder.build().map_err(|error| error.to_string())?;
    let created = match libjvm {
        Some(path) => JavaVM::with_libjvm(args, || Ok(path.to_owned())),
        None => JavaVM::new(args),
    }
    .map_err(|error| error.to_string())?;
    let _ = VM.set(created);
    Ok(())
}

fn class_name(name: &str) -> JNIString {
    JNIString::from(name.replace('.', "/"))
}

fn call_string(class: &str, method: &str, input: &str) -> Result<String, String> {
    let sig = RuntimeMethodSignature::from_str("(Ljava/lang/String;)Ljava/lang/String;").map_err(|e| e.to_string())?;
    vm()?
        .attach_current_thread(|env| -> jni::errors::Result<String> {
            let value = env.new_string(input)?;
            let result = env
                .call_static_method(class_name(class), JNIString::from(method), MethodSignature::from(&sig), &[JValue::Object(&value)])?
                .l()?;
            if result.is_null() {
                return Ok(String::new());
            }
            let text = env.cast_local::<JString>(result)?;
            text.try_to_string(env)
        })
        .map_err(|error| error.to_string())
}

fn call_int2(class: &str, method: &str, left: i32, right: i32) -> Result<i32, String> {
    let sig = RuntimeMethodSignature::from_str("(II)I").map_err(|e| e.to_string())?;
    vm()?
        .attach_current_thread(|env| -> jni::errors::Result<i32> {
            env.call_static_method(class_name(class), JNIString::from(method), MethodSignature::from(&sig), &[JValue::Int(left), JValue::Int(right)])?
                .i()
        })
        .map_err(|error| error.to_string())
}

fn call_long0(class: &str, method: &str) -> Result<i64, String> {
    let sig = RuntimeMethodSignature::from_str("()J").map_err(|e| e.to_string())?;
    vm()?
        .attach_current_thread(|env| -> jni::errors::Result<i64> {
            env.call_static_method(class_name(class), JNIString::from(method), MethodSignature::from(&sig), &[])?
                .j()
        })
        .map_err(|error| error.to_string())
}

/// Start the process JVM. `libjvm` is the path of `libjvm.so` (null: locate through `JAVA_HOME`); `options` holds
/// one JVM option per line (`-Djava.class.path=...`, `-Xmx256m`). Returns 0, or -1 with the reason in last_error.
///
/// # Safety
/// Both pointers are null or valid NUL-terminated strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bunos_jvm_start(libjvm: *const c_char, options: *const c_char) -> i32 {
    // SAFETY: forwarded caller contract.
    let (libjvm, options) = unsafe { (arg(libjvm), arg(options).unwrap_or("")) };
    match start(libjvm, options) {
        Ok(()) => 0,
        Err(error) => {
            fail(error);
            -1
        }
    }
}

/// 1 when the process JVM is running.
#[unsafe(no_mangle)]
pub extern "C" fn bunos_jvm_started() -> i32 {
    i32::from(VM.get().is_some())
}

/// Call `static String class.method(String)`. Returns an owned string, or null on failure (see last_error).
///
/// # Safety
/// All pointers are valid NUL-terminated strings (`input` may be null for the empty string).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bunos_jvm_call_static_string(class: *const c_char, method: *const c_char, input: *const c_char) -> *mut c_char {
    // SAFETY: forwarded caller contract.
    let (Some(class), Some(method)) = (unsafe { arg(class) }, unsafe { arg(method) }) else {
        fail("class and method are required");
        return std::ptr::null_mut();
    };
    // SAFETY: forwarded caller contract.
    let input = unsafe { arg(input) }.unwrap_or("");
    match call_string(class, method, input) {
        Ok(text) => owned(text),
        Err(error) => {
            fail(error);
            std::ptr::null_mut()
        }
    }
}

/// Call `static int class.method(int, int)` and store the result in `out`. Returns 0, or -1 (see last_error).
///
/// # Safety
/// `class`/`method` are valid NUL-terminated strings; `out` is a valid, writable `int32_t` pointer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bunos_jvm_call_static_int2(class: *const c_char, method: *const c_char, left: i32, right: i32, out: *mut i32) -> i32 {
    // SAFETY: forwarded caller contract.
    let (Some(class), Some(method)) = (unsafe { arg(class) }, unsafe { arg(method) }) else {
        fail("class and method are required");
        return -1;
    };
    if out.is_null() {
        fail("out is null");
        return -1;
    }
    match call_int2(class, method, left, right) {
        Ok(value) => {
            // SAFETY: checked non-null, writable per contract.
            unsafe { out.write(value) };
            0
        }
        Err(error) => {
            fail(error);
            -1
        }
    }
}

/// Call `static long class.method()` and store the result in `out`. Returns 0, or -1 (see last_error).
///
/// # Safety
/// `class`/`method` are valid NUL-terminated strings; `out` is a valid, writable `int64_t` pointer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bunos_jvm_call_static_long(class: *const c_char, method: *const c_char, out: *mut i64) -> i32 {
    // SAFETY: forwarded caller contract.
    let (Some(class), Some(method)) = (unsafe { arg(class) }, unsafe { arg(method) }) else {
        fail("class and method are required");
        return -1;
    };
    if out.is_null() {
        fail("out is null");
        return -1;
    }
    match call_long0(class, method) {
        Ok(value) => {
            // SAFETY: checked non-null, writable per contract.
            unsafe { out.write(value) };
            0
        }
        Err(error) => {
            fail(error);
            -1
        }
    }
}

/// Last failure of the calling thread as an owned string (null when none). Release with [`bunos_jvm_free`].
#[unsafe(no_mangle)]
pub extern "C" fn bunos_jvm_last_error() -> *mut c_char {
    LAST_ERROR.with(|slot| slot.borrow().as_ref().map_or(std::ptr::null_mut(), |text| text.clone().into_raw()))
}

/// Release a string returned by this library.
///
/// # Safety
/// `ptr` is null or a pointer returned by this library that was not freed yet.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bunos_jvm_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        // SAFETY: ptr came from CString::into_raw in this library.
        drop(unsafe { CString::from_raw(ptr) });
    }
}
