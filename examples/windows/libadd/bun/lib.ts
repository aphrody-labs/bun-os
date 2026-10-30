// Class-library analog: `add` exported from a module; the native cpp/rust dlls are exercised through bun:ffi in the test matrix.
export const add = (a: number, b: number) => a + b;
if (import.meta.main) console.log(add(2, 3));
