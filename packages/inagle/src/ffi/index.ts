/**
 * @file ffi/index.ts
 * @description Consolidated Level-5 binary contracts, NIE Rust bridge, and Bun FFI bindings.
 */

// Authoritative Level-5 binary contracts & Rust bridge
export * from "../nie-bridge/index.js";

// High-performance Bun FFI binding to native iecode Rust engine
export * from "./nie.js";

// Bun-native C-ABI FFI bindings & utilities
export { dlopen, FFIType, suffix, ptr, CString, JSCallback, CFunction, toArrayBuffer } from "bun:ffi";
