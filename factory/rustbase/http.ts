// SPDX-License-Identifier: Apache-2.0
// The one place rustbase talks to `gh` and plain HTTP (gen.ts and rank.ts share it).
export async function ghToken(): Promise<string> {
  const p = Bun.spawn(["gh", "auth", "token"], { stdout: "pipe", stderr: "pipe" });
  const token = (await new Response(p.stdout).text()).trim();
  await p.exited;
  if (!token) throw new Error("gh auth token returned nothing");
  return token;
}

export async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers: { "user-agent": "bunos-rustbase", ...headers } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}
