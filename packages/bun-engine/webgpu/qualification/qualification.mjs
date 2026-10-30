const query = new URLSearchParams(location.search);
const receiptUrl = query.get("receipt") ?? "http://127.0.0.1:4540/receipt";
const pluginUrl = query.get("plugin") ?? "../webx/harness/vkwebgpu-plugin.mjs";
const bindingUrl = query.get("binding") ?? "../pkg/gpu.js";
const adapterUrl = query.get("adapter") ?? "../adapter.js";
const output = document.querySelector("#receipt");
const canvas = document.querySelector("#target");
const uncaptured = [];
let seq = 1;
const packetTrace = [];
const captureWireTrace = query.get("trace") === "1";
const expectedNagaWasmSha256 = "d1433557ebd58176855b6bff0f40de9c4aa7cd120668110a3570fc2c5987ec48";

class Writer {
  bytes = [];
  u32(value) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value, true);
    this.raw(b);
    return this;
  }
  i32(value) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, value, true);
    this.raw(b);
    return this;
  }
  f32(value) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, value, true);
    this.raw(b);
    return this;
  }
  u64(value) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(value), true);
    this.raw(b);
    return this;
  }
  raw(value) {
    this.bytes.push(...new Uint8Array(value));
    return this;
  }
  finish() {
    return Uint8Array.from(this.bytes);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function resultOk(result, cmd) {
  assert(result?.result === 0, `WebX cmd 0x${cmd.toString(16)} failed (${result?.result}): ${decode(result?.data)}`);
}
function decode(bytes) {
  return bytes ? new TextDecoder().decode(bytes) : "";
}
async function withValidation(device, label, operation) {
  device.pushErrorScope("validation");
  const uncapturedStart = uncaptured.length;
  let value;
  try {
    value = await operation();
  } catch (error) {
    let scopeError;
    try {
      scopeError = await device.popErrorScope();
    } catch (popError) {
      scopeError = popError;
    }
    throw new Error(
      `${label} threw: ${error?.stack ?? error}; validation=${scopeError == null ? "none" : (scopeError?.message ?? String(scopeError))}`,
      { cause: error },
    );
  }
  const scopeError = await device.popErrorScope();
  const freshUncaptured = uncaptured.slice(uncapturedStart);
  assert(!scopeError, `${label} WebGPU validation: ${scopeError?.message}`);
  assert(freshUncaptured.length === 0, `${label} uncaptured WebGPU error: ${freshUncaptured.join(" | ")}`);
  return value;
}

async function dispatch(plugin, device, cmd, payload, { gpu = true } = {}) {
  const sequence = seq++;
  const run = () => plugin.dispatch(cmd, sequence, payload);
  const result = gpu ? await withValidation(device, `dispatch 0x${cmd.toString(16)}`, run) : await run();
  if (captureWireTrace) {
    const base64 = bytes => {
      let text = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        text += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      return btoa(text);
    };
    packetTrace.push({
      command: cmd,
      sequence,
      payloadBase64: base64(payload),
      result: result.result,
      responseBase64: base64(result.data),
    });
  }
  resultOk(result, cmd);
  return result.data;
}

function packetSpirv(deviceHandle, moduleHandle, words) {
  return new Writer().u64(deviceHandle).u64(moduleHandle).u32(words.byteLength).raw(words.buffer).finish();
}
function resourceBytes(url) {
  return fetch(url).then(response => {
    assert(response.ok, `Could not fetch ${url}: HTTP ${response.status}`);
    return response.arrayBuffer();
  });
}
function wordsFrom(buffer) {
  assert(buffer.byteLength % 4 === 0, "SPIR-V file length is not word-aligned");
  return new Uint32Array(buffer.slice(0));
}
async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function readCanvasPixels(plugin) {
  // The plugin copies the exact presentation texture before the browser can
  // discard it; mapped GPU bytes remain valid across asynchronous completion.
  return plugin.readbackPresentedFrame();
}

async function run() {
  assert(navigator.gpu, "WebGPU is unavailable in this browser");
  const pluginModule = await import(new URL(pluginUrl, location.href));
  const binding = await import(new URL(bindingUrl, location.href));
  const adapterBridge = await import(new URL(adapterUrl, location.href));
  const wasmBytes = await resourceBytes(new URL("../pkg/gpu_bg.wasm", import.meta.url));
  const wasmSha256 = await sha256(wasmBytes);
  assert(wasmSha256 === expectedNagaWasmSha256, `Unexpected Naga WASM artifact digest: ${wasmSha256}`);
  if (typeof binding.default === "function") await binding.default();
  assert(typeof binding.spirv_to_wgsl === "function", "WASM binding lacks the real spirv_to_wgsl export");
  assert(
    typeof adapterBridge.createWebXShaderTranslator === "function",
    "Built bun-engine adapter lacks createWebXShaderTranslator",
  );
  const adapter = await navigator.gpu.requestAdapter();
  assert(adapter, "No WebGPU adapter available");
  const device = await adapter.requestDevice();
  device.addEventListener("uncapturederror", event => uncaptured.push(event.error?.message ?? String(event.error)));
  const shaderTranslator = adapterBridge.createWebXShaderTranslator(binding);
  const plugin = await pluginModule.loadPlugin({
    shaderTranslator,
    capturePresentedFrames: true,
  });
  await withValidation(device, "plugin initialization", () => plugin.initialize(adapter, device, canvas));

  const vertexBytes = await resourceBytes(new URL("./triangle.vert.spv", import.meta.url));
  const fragmentBytes = await resourceBytes(new URL("./triangle.frag.spv", import.meta.url));
  const vertexSha256 = await sha256(vertexBytes);
  const fragmentSha256 = await sha256(fragmentBytes);
  const vertexWords = wordsFrom(vertexBytes);
  const fragmentWords = wordsFrom(fragmentBytes);
  const deviceHandle = 1n;
  const swapchainHandle = 3n;
  const renderPassHandle = 4n;
  const framebufferHandle = 5n;
  const layoutHandle = 6n;
  const pipelineHandle = 7n;
  const commandBufferHandle = 8n;
  const width = canvas.width;
  const height = canvas.height;
  const format = 44; // VK_FORMAT_B8G8R8A8_UNORM; host maps it to bgra8unorm.

  const swap = new Writer()
    .u64(deviceHandle)
    .u64(swapchainHandle)
    .u64(0n)
    .u32(2)
    .u32(format)
    .u32(0)
    .u32(width)
    .u32(height)
    .u32(1)
    .u32(0x10)
    .finish();
  await dispatch(plugin, device, 0x0020, swap);
  const imageList = await dispatch(plugin, device, 0x0022, new Uint8Array());
  const imageViewHandles = [];
  const listView = new DataView(imageList.buffer, imageList.byteOffset, imageList.byteLength);
  const imageCount = listView.getUint32(0, true);
  assert(
    imageCount >= 2 && imageList.byteLength >= 4 + imageCount * 8,
    "WebX returned an invalid swapchain image list",
  );
  for (let index = 0; index < imageCount; index++) {
    const imageHandle = listView.getBigUint64(4 + index * 8, true);
    const viewHandle = 20n + BigInt(index);
    imageViewHandles.push(viewHandle);
    const imageView = new Writer()
      .u64(deviceHandle)
      .u64(viewHandle)
      .u64(imageHandle)
      .u32(1) // VkImageViewType::TYPE_2D
      .u32(format)
      .u32(0)
      .u32(0)
      .u32(0)
      .u32(0) // identity component swizzles
      .u32(1) // color aspect
      .u32(0) // base mip
      .u32(1) // mip level count
      .u32(0) // base array layer
      .u32(1) // array layer count
      .finish();
    await dispatch(plugin, device, 0x0046, imageView);
  }

  // VkAttachmentDescription(36), one graphics subpass with one color reference, no dependencies.
  const renderPass = new Writer()
    .u64(deviceHandle)
    .u64(renderPassHandle)
    .u32(1)
    .u32(0)
    .u32(format)
    .u32(1)
    .u32(1)
    .u32(0)
    .u32(2)
    .u32(1)
    .u32(0)
    .u32(1000001002)
    .u32(1)
    .u32(0)
    .u32(0)
    .u32(1)
    .u32(0)
    .u32(2)
    .u32(0)
    .u32(0)
    .finish();
  await dispatch(plugin, device, 0x0057, renderPass);

  const framebuffer = new Writer()
    .u64(deviceHandle)
    .u64(framebufferHandle)
    .u64(renderPassHandle)
    .u32(1)
    .u64(imageViewHandles[0])
    .u32(width)
    .u32(height)
    .u32(1)
    .finish();
  await dispatch(plugin, device, 0x0059, framebuffer);
  await dispatch(plugin, device, 0x0052, new Writer().u64(deviceHandle).u64(layoutHandle).u32(0).u32(0).finish());

  const vertHandle = 30n;
  const fragHandle = 31n;
  await dispatch(plugin, device, 0x0050, packetSpirv(deviceHandle, vertHandle, vertexWords));
  await dispatch(plugin, device, 0x0050, packetSpirv(deviceHandle, fragHandle, fragmentWords));

  const pipelineWriter = new Writer()
    .u64(deviceHandle)
    .u64(pipelineHandle)
    .u32(0)
    .u64(layoutHandle)
    .u64(renderPassHandle)
    .u32(0)
    .u32(2)
    .u32(1)
    .u64(vertHandle)
    .u32(4)
    .raw(new TextEncoder().encode("main"))
    .u32(16)
    .u64(fragHandle)
    .u32(4)
    .raw(new TextEncoder().encode("main"))
    .u32(0)
    .u32(0)
    .u32(3)
    .u32(0);
  const raster = new Uint8Array(64);
  new DataView(raster.buffer).setUint32(28, 0, true); // fill mode
  new DataView(raster.buffer).setUint32(32, 0, true); // no culling
  new DataView(raster.buffer).setUint32(36, 0, true); // counter-clockwise
  pipelineWriter.raw(raster).raw(new Uint8Array(104)).u32(1).u32(0).u32(1).u32(0).u32(0).u32(1).u32(0).u32(0).u32(15);
  await dispatch(plugin, device, 0x0054, pipelineWriter.finish());

  await dispatch(plugin, device, 0x0023, new Uint8Array());
  await dispatch(plugin, device, 0x0075, new Writer().u64(commandBufferHandle).u32(0).finish(), { gpu: false });
  const record = async (opcode, payload) =>
    dispatch(plugin, device, opcode, new Writer().u64(commandBufferHandle).raw(payload).finish(), { gpu: false });
  await record(
    0x0080,
    new Writer()
      .u64(renderPassHandle)
      .u64(framebufferHandle)
      .i32(0)
      .i32(0)
      .u32(width)
      .u32(height)
      .u32(1)
      .f32(0)
      .f32(0)
      .f32(0)
      .f32(1)
      .finish(),
  );
  await record(0x0085, new Writer().u32(0).u64(pipelineHandle).finish());
  await record(0x0090, new Writer().u32(0).u32(1).f32(0).f32(0).f32(width).f32(height).f32(0).f32(1).finish());
  await record(0x0091, new Writer().u32(0).u32(1).i32(0).i32(0).u32(width).u32(height).finish());
  await record(0x008a, new Writer().u32(3).u32(1).u32(0).u32(0).finish());
  await record(0x0081, new Uint8Array());
  await dispatch(plugin, device, 0x0076, new Writer().u64(commandBufferHandle).finish(), { gpu: false });
  const submit = new Writer().u64(2n).u64(0n).u32(1).u32(1).u64(commandBufferHandle).finish();
  await dispatch(plugin, device, 0x00b0, submit);
  await withValidation(device, "queue completion", () => device.queue.onSubmittedWorkDone());
  await dispatch(plugin, device, 0x0024, new Writer().u64(swapchainHandle).u32(0).finish());
  await withValidation(device, "present completion", () => device.queue.onSubmittedWorkDone());

  const pixels = await withValidation(device, "presented GPU pixel readback", () => readCanvasPixels(plugin));
  const centerOffset = (Math.floor(pixels.height / 2) * pixels.width + Math.floor(pixels.width / 2)) * 4;
  const cornerOffset = 4 * 4;
  const center = Array.from(pixels.data.slice(centerOffset, centerOffset + 4));
  const corner = Array.from(pixels.data.slice(cornerOffset, cornerOffset + 4));
  assert(center[0] > 180 && center[1] < 80 && center[2] < 80, `Expected red triangle center pixel, got ${center}`);
  assert(corner[0] < 40 && corner[1] < 40 && corner[2] < 40, `Expected black clear pixel, got ${corner}`);
  assert(uncaptured.length === 0, `Uncaptured WebGPU errors: ${uncaptured.join(" | ")}`);

  const receipt = {
    status: "passed",
    qualification: "webx-wire-spirv-webgpu-triangle",
    scope:
      "patched WebX plugin dispatch, Naga 30 WASM SPIR-V translation, validated GPU shader modules, one RGBA/BGRA8 single-color graphics pipeline, queue submit, present and browser pixel readback",
    excluded: [
      "general Vulkan conformance",
      "DXVK compatibility",
      "compute",
      "VkRenderPass2",
      "dynamic rendering",
      "non-vertex/fragment stages",
      "depth/stencil",
      "multisample",
    ],
    adapter: adapter.info?.description ?? "unknown",
    nagaWasmSha256: wasmSha256,
    vertexSpirvSha256: vertexSha256,
    fragmentSpirvSha256: fragmentSha256,
    imageSize: [pixels.width, pixels.height],
    wireTrace: captureWireTrace ? packetTrace : undefined,
    centerPixel: center,
    backgroundPixel: corner,
    uncapturedErrors: uncaptured,
    timestamp: new Date().toISOString(),
  };
  output.textContent = JSON.stringify(receipt, null, 2);
  const posted = await fetch(receiptUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(receipt),
  });
  assert(posted.ok, `Local Bun receipt endpoint returned HTTP ${posted.status}`);
  receipt.receiptAccepted = true;
  output.textContent = JSON.stringify(receipt, null, 2);
  document.documentElement.dataset.qualification = "passed";
  plugin.destroy();
}

run().catch(error => {
  const receipt = {
    status: "failed",
    qualification: "webx-wire-spirv-webgpu-triangle",
    error: error?.stack ?? String(error),
    uncapturedErrors: uncaptured,
    timestamp: new Date().toISOString(),
  };
  output.textContent = JSON.stringify(receipt, null, 2);
  document.documentElement.dataset.qualification = "failed";
  fetch(receiptUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(receipt),
  }).catch(postError => console.error("Could not post failed qualification receipt", postError));
  console.error(error);
});
