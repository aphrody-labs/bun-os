// Consumer-view type assertions, resolved through package.json `exports` (the `types`
// conditions) exactly as a dependent project sees them. Checked by `tsconfig.types.json` with
// `skipLibCheck: false`; never executed and not published.
import canvasModule, {
  GlobalFonts,
  Image,
  SvgExportFlag,
  aphrodyCanvasVersion,
  createCanvas,
  createNativeCanvas,
  drawM3Scene,
  loadImage,
  loadNativeCanvas,
  loadNativeImage,
  type Canvas,
  type M3Scene,
  type SKRSContext2D,
  type SvgCanvas,
} from "@aphrody/canvas";
import { createBrowserCanvas, createM3CanvasSurface, type M3CanvasSurface } from "@aphrody/canvas/site";

export async function consumerView(scene: M3Scene): Promise<void> {
  const version: "1.4.7" = aphrodyCanvasVersion;
  const canvas: Canvas = createCanvas(64, 32);
  const ctx: SKRSContext2D = canvas.getContext("2d");
  ctx.fillRect(0, 0, 64, 32);
  const png: Buffer = await canvas.encode("png");
  const webp: Buffer = await canvas.encode("webp", 90);
  const image: Image = await loadImage(png);
  const decoded: Image = await loadNativeImage(webp);
  const native: Canvas = await createNativeCanvas(8, 8);
  const svg: SvgCanvas = await createNativeCanvas(8, 8, SvgExportFlag.NoPrettyXML);
  const sameModule: typeof createCanvas = (await loadNativeCanvas()).createCanvas;
  const viaDefault: Canvas = canvasModule.createCanvas(1, 1);
  const fonts: boolean = GlobalFonts.has("Roboto");
  const surface: M3CanvasSurface = createM3CanvasSurface({
    density: "compact",
  });
  // With the DOM lib (this tsconfig), the browser element is exactly HTMLCanvasElement.
  const element: HTMLCanvasElement = createBrowserCanvas({
    width: 4,
    height: 4,
  });
  const drawn: Canvas = await drawM3Scene(scene);
  // @ts-expect-error the scene contract is the precise Rust mirror, not an open record
  await drawM3Scene({ width: 1, height: 1 });
  void [version, image, decoded, native, svg, sameModule, viaDefault, fonts, surface, element, drawn];
}
