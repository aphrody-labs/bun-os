import { $ } from "bun";
import cp from "node:child_process";

try {
  const res = cp.execSync("ffmpeg -version", { encoding: "utf8" });
  console.log("ffmpeg found:", res.split("\n")[0]);
} catch (e) {
  console.log("ffmpeg not in PATH directly");
}
