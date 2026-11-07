import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";

const chromePath =
  process.env.CHROME_BIN ??
  (process.platform === "win32"
    ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe")
    : "google-chrome");
const outDir = "replica/screens/audit";
fs.mkdirSync(outDir, { recursive: true });

console.log("Using Chrome at:", chromePath);

async function captureUrl(url: string, outName: string) {
  const outFile = path.resolve(outDir, outName);
  console.log(`Capturing ${url} -> ${outFile}...`);
  try {
    cp.execSync(
      `"${chromePath}" --headless=new --disable-gpu --window-size=1440,900 --hide-scrollbars --screenshot="${outFile}" "${url}"`,
      { timeout: 30000, stdio: "ignore" }
    );
    if (fs.existsSync(outFile)) {
      const stat = fs.statSync(outFile);
      console.log(`✓ Captured ${outName} (${stat.size} bytes)`);
      return outFile;
    }
  } catch (err: any) {
    console.error(`Failed to capture ${url}:`, err.message);
  }
  return null;
}

async function main() {
  console.log("=== Real Chrome Competitor & Site Audit ===");
  // 1. Google Workspace
  await captureUrl("https://workspace.google.com", "audit-competitor-google-workspace.png");
  // 2. Cosmic Desktop / System76
  await captureUrl("https://system76.com/cosmic", "audit-competitor-cosmic-desktop.png");
  // 3. Omarchy
  await captureUrl("https://omarchy.org", "audit-competitor-omarchy.png");
  // 4. Current aphrody.com
  await captureUrl("https://aphrody.com", "audit-current-aphrody-live.png");
  console.log("Audit screenshots complete.");
}

main().catch(console.error);
