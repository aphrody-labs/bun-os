// Keep Bun's Blob/FormData implementation for multipart API tests while registering the DOM
// globals needed by React. happy-dom's FormData drops the filename passed to append().
const nativeBlob = globalThis.Blob;
const nativeFile = globalThis.File;
const nativeFormData = globalThis.FormData;

await import("@aphrody/m3-config/test/dom");

globalThis.Blob = nativeBlob;
globalThis.File = nativeFile;
globalThis.FormData = nativeFormData;

export {};
