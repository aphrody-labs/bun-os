/**
 * WebGPU Glass Pipeline Controller
 * Initializes WebGPU device, compiles WGSL shader, manages uniform buffer updates,
 * and seamlessly falls back to 2D canvas procedural glass gradient if WebGPU is absent.
 */

import wgslSource from "./glass.wgsl" with { type: "text" };

export interface GlassShaderOptions {
  canvas: HTMLCanvasElement;
  roughness?: number;
  dispersion?: number;
  refractionIndex?: number;
  ambientIntensity?: number;
}

export class GlassShaderController {
  private canvas: HTMLCanvasElement;
  private running = false;
  private animId: number | null = null;
  private device: any = null;
  private context: any = null;
  private pipeline: any = null;
  private uniformBuffer: any = null;
  private bindGroup: any = null;
  private startTime = performance.now();
  private roughness: number;
  private dispersion: number;
  private refractionIndex: number;
  private ambientIntensity: number;

  constructor(options: GlassShaderOptions) {
    this.canvas = options.canvas;
    this.roughness = options.roughness ?? 0.08;
    this.dispersion = options.dispersion ?? 0.15;
    this.refractionIndex = options.refractionIndex ?? 1.12;
    this.ambientIntensity = options.ambientIntensity ?? 1.25;
  }

  public async start(): Promise<boolean> {
    if (this.running) return true;
    this.running = true;

    // Check for WebGPU availability in browser
    const nav = typeof navigator !== "undefined" ? (navigator as any) : null;
    if (nav?.gpu) {
      try {
        const adapter = await nav.gpu.requestAdapter();
        if (adapter) {
          this.device = await adapter.requestDevice();
          this.context = this.canvas.getContext("webgpu");
          const format = nav.gpu.getPreferredCanvasFormat();
          this.context.configure({
            device: this.device,
            format,
            alphaMode: "premultiplied",
          });

          const shaderModule = this.device.createShaderModule({
            code: wgslSource,
          });

          this.pipeline = this.device.createRenderPipeline({
            layout: "auto",
            vertex: {
              module: shaderModule,
              entryPoint: "vs_main",
            },
            fragment: {
              module: shaderModule,
              entryPoint: "fs_main",
              targets: [{ format }],
            },
            primitive: {
              topology: "triangle-list",
            },
          });

          // 32-byte aligned uniform buffer
          this.uniformBuffer = this.device.createBuffer({
            size: 32,
            usage: 0x0040 | 0x0008, // UNIFORM | COPY_DST
          });

          this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
          });

          this.loopWebGPU();
          return true;
        }
      } catch (err) {
        console.warn("WebGPU initialization failed, falling back to 2D canvas shader", err);
      }
    }

    // High-performance Canvas2D procedural gradient fallback
    this.loopCanvas2D();
    return true;
  }

  private loopWebGPU = () => {
    if (!this.running) return;

    const time = (performance.now() - this.startTime) / 1000;
    const uniformData = new Float32Array([
      this.canvas.width,
      this.canvas.height,
      time,
      this.roughness,
      this.dispersion,
      this.refractionIndex,
      this.ambientIntensity,
      0.0, // padding
    ]);

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.05, g: 0.07, b: 0.1, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.draw(3);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    this.animId = requestAnimationFrame(this.loopWebGPU);
  };

  private loopCanvas2D = () => {
    if (!this.running) return;

    const ctx = this.canvas.getContext("2d");
    if (ctx) {
      const w = this.canvas.width;
      const h = this.canvas.height;
      const t = (performance.now() - this.startTime) / 2000;

      const grad = ctx.createRadialGradient(
        w * 0.5 + Math.sin(t) * (w * 0.2),
        h * 0.4 + Math.cos(t * 0.8) * (h * 0.15),
        20,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.8
      );

      grad.addColorStop(0, "rgba(28, 42, 68, 0.85)");
      grad.addColorStop(0.5, "rgba(18, 25, 38, 0.92)");
      grad.addColorStop(1, "rgba(10, 14, 20, 0.98)");

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Top specular hairline
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fillRect(0, 0, w, 1);
    }

    this.animId = requestAnimationFrame(this.loopCanvas2D);
  };

  public stop() {
    this.running = false;
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }
}
