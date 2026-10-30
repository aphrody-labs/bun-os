#!/usr/bin/env bun
// Gemini reference smoke test: one real call per Bun OS layer, pass/fail/skip per layer.
//   bun factory/google/qualify-gemini.ts [--json]
// Service identity: aphrody-bot through the impersonated ADC (/etc/aphrody/google/adc.json) or gcloud's
// impersonation config; project aphrody, region us-central1. Prints no token.
const project = Bun.env.GOOGLE_CLOUD_PROJECT ?? "aphrody";
const region = Bun.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
const model = Bun.env.APHRODY_GEMINI_MODEL ?? "gemini-2.5-flash";
const backend = Bun.env.APHRODY_BACKEND ?? "http://127.0.0.1:8790";
const PROMPT = "Reply with exactly: bun-os ok";

type Result = { layer: string; status: "pass" | "fail" | "skip"; detail: string };
const results: Result[] = [];

async function sh(cmd: string[], timeoutMs = 60_000): Promise<{ code: number; out: string; err: string }> {
  if (!Bun.which(cmd[0]!)) return { code: 127, out: "", err: `${cmd[0]} not installed` };
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out.trim(), err: err.trim() };
}

async function serviceToken(): Promise<string | undefined> {
  const viaCrate = await sh(["bun-os-google", "token", "--account", "service"]);
  if (viaCrate.code === 0 && viaCrate.out) return viaCrate.out;
  const viaGcloud = await sh(["gcloud", "auth", "print-access-token"]);
  return viaGcloud.code === 0 && viaGcloud.out ? viaGcloud.out : undefined;
}

async function layer(name: string, fn: () => Promise<Omit<Result, "layer">>) {
  try {
    results.push({ layer: name, ...(await fn()) });
  } catch (e) {
    results.push({ layer: name, status: "fail", detail: String(e instanceof Error ? e.message : e).slice(0, 200) });
  }
}

const token = await serviceToken();

await layer("vertex-rest (Bun fetch, aphrody-bot)", async () => {
  if (!token) return { status: "fail", detail: "no service-account token (ADC/gcloud)" };
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: PROMPT }] }] }),
  });
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  return res.ok && /bun-os ok/i.test(text) ? { status: "pass", detail: `${model}: ${text}` } : { status: "fail", detail: body.error?.message ?? `HTTP ${res.status}` };
});

await layer("vertex-openai (chat gateway contract)", async () => {
  if (!token) return { status: "fail", detail: "no token" };
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/endpoints/openapi/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: `google/${model}`, messages: [{ role: "user", content: PROMPT }] }),
  });
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | { error?: { message?: string } }[];
  const one = Array.isArray(body) ? body[0] : body;
  const text = (one as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content?.trim() ?? "";
  return res.ok && /bun-os ok/i.test(text) ? { status: "pass", detail: text } : { status: "fail", detail: one?.error?.message ?? `HTTP ${res.status}` };
});

await layer("rust crate (bun-os-google check)", async () => {
  const r = await sh(["bun-os-google", "check"], 120_000);
  if (r.code === 127) return { status: "skip", detail: "bun-os-google binary not installed" };
  return r.code === 0 ? { status: "pass", detail: r.out.split("\n").slice(0, 2).join("; ") } : { status: "fail", detail: (r.out || r.err).slice(0, 200) };
});

await layer("backend route (/api/google/status)", async () => {
  const res = await fetch(`${backend}/api/google/status`).catch(() => undefined);
  if (!res) return { status: "skip", detail: `${backend} not reachable` };
  if (res.status === 404) return { status: "skip", detail: "routes not merged in the running backend" };
  const body = (await res.json()) as { service_account?: { token?: string } };
  return body.service_account?.token === "ok" ? { status: "pass", detail: "service account token ok" } : { status: "fail", detail: JSON.stringify(body).slice(0, 200) };
});

await layer("chat gateway (/api/chat/v1)", async () => {
  const res = await fetch(`${backend.replace(/:\d+$/, ":8794")}/v1/models`).catch(() => undefined);
  if (!res) return { status: "skip", detail: "chat gateway not running on :8794" };
  return res.ok ? { status: "pass", detail: `HTTP ${res.status}` } : { status: "fail", detail: `HTTP ${res.status}` };
});

await layer("gemini-cli", async () => {
  const r = await sh(["gemini", "--version"]);
  if (r.code === 127) return { status: "skip", detail: "gemini CLI not installed" };
  return r.code === 0 ? { status: "pass", detail: r.out } : { status: "fail", detail: r.err.slice(0, 200) };
});

await layer("android app (com.google.android.apps.bard)", async () => {
  const r = await sh(["adb", "-s", Bun.env.APHRODY_ANDROID_SERIAL ?? "127.0.0.1:5555", "shell", "pm", "path", "com.google.android.apps.bard"]);
  if (r.code === 127) return { status: "skip", detail: "adb not installed" };
  return r.out.includes("package:") ? { status: "pass", detail: "installed" } : { status: "skip", detail: "not installed (Play sign-in by the owner pending)" };
});

if (Bun.argv.includes("--json")) console.log(JSON.stringify(results, null, 2));
else for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.layer}: ${r.detail}`);
process.exit(results.some(r => r.status === "fail") ? 1 : 0);
