// SPDX-License-Identifier: Apache-2.0
/** Workspace SPA navigation never falls back to the unrelated desktop index. */
export async function workspaceResponse(
  request: Request,
  assets: { fetch(request: Request): Promise<Response> },
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  if (url.pathname === "/workspace")
    return Response.redirect(
      new URL(`/workspace/${url.search}`, url).href,
      308,
    );
  const navigation =
    request.headers.get("accept")?.includes("text/html") ||
    !url.pathname.split("/").at(-1)?.includes(".");
  const target = new URL(
    navigation ? "/workspace/index.html" : url.pathname,
    url,
  );
  target.search = url.search;
  // Fetch HTML even for HEAD so its deployment prefix can be authenticated.
  const response = await assets.fetch(
    new Request(target.href, { method: "GET", headers: request.headers }),
  );
  if (!response.ok)
    return new Response(
      request.method === "HEAD" ? null : response.body,
      response,
    );
  const type = response.headers.get("content-type") ?? "";
  if (
    !navigation &&
    !url.pathname.endsWith(".html") &&
    type.includes("text/html")
  )
    return new Response("Workspace asset not found", { status: 404 });
  if (
    (navigation || url.pathname.endsWith(".html")) &&
    type.includes("text/html")
  ) {
    const html = await response.text();
    if (!/<base\s+href=["']\/workspace\/["']/.test(html))
      return new Response(
        "Aphrody Workspace has not been assembled on this host.",
        { status: 503 },
      );
    return new Response(request.method === "HEAD" ? null : html, {
      status: response.status,
      headers: response.headers,
    });
  }
  return new Response(
    request.method === "HEAD" ? null : response.body,
    response,
  );
}
