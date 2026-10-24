// SPDX-License-Identifier: Apache-2.0
// The browser reader must never gain access to VPS loopback, mesh or metadata endpoints.
function publicIPv4(address: string) {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  )
    return false;
  const [a, b] = parts as [number, number, number, number];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export async function publicFetch(
  input: string,
  init: RequestInit,
): Promise<Response> {
  let url = new URL(input);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      (url.port && !["80", "443"].includes(url.port))
    )
      throw new Error("Reader target is not a public HTTP origin");
    const records = await Bun.dns.lookup(url.hostname, { family: 4 });
    if (
      !records.length ||
      records.some((record) => !publicIPv4(record.address))
    )
      throw new Error("Private reader target");
    const pinned = new URL(url);
    pinned.hostname = records[0]!.address;
    const headers = new Headers(init.headers);
    headers.set("host", url.host);
    const response = await fetch(pinned.href, {
      ...init,
      headers,
      redirect: "manual",
      proxy: "",
      tls: { serverName: url.hostname },
    });
    if (
      [301, 302, 303, 307, 308].includes(response.status) &&
      response.headers.has("location")
    ) {
      await response.body?.cancel();
      url = new URL(response.headers.get("location")!, url);
      continue;
    }
    Object.defineProperty(response, "url", { value: url.href });
    return response;
  }
  throw new Error("Too many reader redirects");
}
