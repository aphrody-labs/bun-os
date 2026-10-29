#!/usr/bin/env python3
"""Smoke the four packaged Aphrody loopback services with disposable credentials.

Services: aphrody-web-api (:3007), aphrody-a2a (:8788), aphrody-ai-http
(:8789) and aphrody-site (:8083). With
--attest FILE a successful run writes the attestation the activation adapter
requires, bound to the release's SHA256SUMS.
"""

import argparse
import datetime
import hashlib
import http.server
import json
import os
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import ExitStack
from pathlib import Path

SERVICES = [
    "aphrody-web-api",
    "aphrody-a2a",
    "aphrody-ai-http",
    "aphrody-site",
]
MCP_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("release", type=Path)
parser.add_argument(
    "--attest", type=Path, help="write the smoke attestation JSON here on success"
)
args = parser.parse_args()
release = args.release.resolve(strict=True)
public_token = secrets.token_hex(32)
backend_token = secrets.token_hex(32)
procs = []
logs = []
log_stack = ExitStack()


def request(
    url, method="GET", body=None, token=None, extra_headers=None, with_headers=False
):
    headers = dict(extra_headers or {})
    if body is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(body).encode()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=50) as resp:
            result = (resp.status, resp.read())
            return (*result, resp.headers) if with_headers else result
    except urllib.error.HTTPError as exc:
        result = (exc.code, exc.read())
        return (*result, exc.headers) if with_headers else result


def probe(url, expected=200, attempts=40):
    for _ in range(attempts):
        try:
            status, body = request(url)
            if status == expected:
                return body
        except (OSError, TimeoutError):
            pass
        time.sleep(0.5)
    raise AssertionError(f"probe failed: {url}")


def jsonrpc_result(payload, request_id):
    """The JSON-RPC response carried by a JSON or SSE Streamable HTTP body."""
    text = payload.decode()
    candidates = [
        line[5:].strip() for line in text.splitlines() if line.startswith("data:")
    ] or [text]
    for candidate in candidates:
        if not candidate:
            continue
        message = json.loads(candidate)
        if isinstance(message, dict) and message.get("id") == request_id:
            if "result" not in message:
                raise AssertionError(f"MCP error: {message.get('error')}")
            return message["result"]
    raise AssertionError("MCP response without a result")


def mcp_tool_names(endpoint):
    """initialize -> notifications/initialized -> tools/list on a stateful MCP session."""
    status, payload, headers = request(
        endpoint,
        "POST",
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "aphrody-stack-smoke", "version": "1"},
            },
        },
        extra_headers=MCP_HEADERS,
        with_headers=True,
    )
    assert status == 200, f"MCP initialize returned HTTP {status}"
    jsonrpc_result(payload, 1)
    session = {**MCP_HEADERS}
    if headers.get("Mcp-Session-Id"):
        session["Mcp-Session-Id"] = headers["Mcp-Session-Id"]
    status, _ = request(
        endpoint,
        "POST",
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        extra_headers=session,
    )
    assert status in (200, 202), f"MCP initialized notification returned HTTP {status}"
    status, payload = request(
        endpoint,
        "POST",
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        extra_headers=session,
    )
    assert status == 200, f"MCP tools/list returned HTTP {status}"
    return [tool["name"] for tool in jsonrpc_result(payload, 2)["tools"]]


class Fixture(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = b'{"status":"ok"}'
        elif self.path == "/index.html":
            body = (
                b"<!doctype html><title>Aphrody smoke fixture</title><h1>Static release smoke</h1>"
                b"<p>This local fixture contains enough visible text for the crawler to classify it "
                b"as a real page. Its content remains deterministic and is served only on "
                b"loopback during this bounded release test.</p>"
            )
        elif self.path == "/render.html":
            body = b'<!doctype html><title>Unrendered</title><script>document.title="Rendered release smoke";document.body.innerHTML="<h1>Hydrated release smoke</h1>";</script>'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header(
            "Content-Type",
            "application/json" if self.path == "/health" else "text/html",
        )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


with tempfile.TemporaryDirectory(prefix="aphrody-stack-smoke-") as temp:
    temp_path = Path(temp)
    fixture = http.server.ThreadingHTTPServer(("127.0.0.1", 33907), Fixture)
    fixture_thread = threading.Thread(target=fixture.serve_forever, daemon=True)
    fixture_thread.start()

    base_env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(temp_path),
        "XDG_CACHE_HOME": str(temp_path / "cache"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
    }

    def start(name, argv, env):
        log = log_stack.enter_context((temp_path / f"{name}.log").open("wb"))
        logs.append((name, log))
        procs.append(
            subprocess.Popen(
                argv,
                cwd=release,
                env={**base_env, **env},
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        )

    try:
        start(
            "aphrody-web-api",
            [str(release / "bin/aphrody-web-api")],
            {
                "PORT": "3007",
                "BXC_API_TOKEN": backend_token,
                "BXC_DIR": str(temp_path / "bxc"),
                "BXC_COOKIES_DIR": str(temp_path / "bxc/cookies"),
                "BXC_DB_PATH": str(temp_path / "bxc/bxc.sqlite"),
                "BXC_STORAGE_DIR": str(temp_path / "bxc/storage"),
                "BXC_RUST_BRIDGE_LIB": str(release / "lib/libaphrody_web_ffi.so"),
                "BXC_RENDER_LIB": str(release / "lib/libbxc_render.so"),
            },
        )
        start(
            "aphrody-a2a",
            [str(release / "bin/aphrody"), "a2a", "serve", "--bind", "127.0.0.1:8788"],
            {
                "APHRODY_A2A_PUBLIC_URL": "https://aphrody.com/api/v1/a2a",
                "APHRODY_A2A_DRY_RUN": "1",
            },
        )
        start(
            "aphrody-ai-http",
            [str(release / "bin/aphrody-mcp"), "http", "--bind", "127.0.0.1:8789"],
            {
                "APHRODY_HOME": str(temp_path / "ai"),
            },
        )
        start(
            "aphrody-site",
            [str(release / "bin/aphrody-site")],
            {
                "APHRODY_SITE_BIND": "127.0.0.1:8083",
                "APHRODY_SITE_WEB_UPSTREAM": "http://127.0.0.1:3007",
                "APHRODY_SITE_WEB_API_TOKEN": public_token,
                "APHRODY_BXC_API_TOKEN": public_token,
                "APHRODY_SITE_WEB_BACKEND_TOKEN": backend_token,
            },
        )

        assert probe("http://127.0.0.1:3007/health") == b"OK"
        assert json.loads(probe("http://127.0.0.1:8788/ping"))["a2a_version"] == "1.0"
        assert json.loads(probe("http://127.0.0.1:8789/healthz"))["status"] == "ok"
        assert mcp_tool_names("http://127.0.0.1:8789/mcp"), "aphrody-mcp lists no tools"
        assert json.loads(probe("http://127.0.0.1:8083/healthz"))["status"] == "ok"
        assert request("http://127.0.0.1:8789/api/v1/models")[0] == 200
        card = json.loads(probe("http://127.0.0.1:8788/.well-known/agent-card.json"))
        assert any(
            item.get("url") == "https://aphrody.com/api/v1/a2a"
            and item.get("protocolVersion") == "1.0"
            for item in card["supportedInterfaces"]
        )
        assert (
            request(
                "http://127.0.0.1:8083/api/v1/web/not-allowlisted", token=public_token
            )[0]
            == 404
        )
        body = {"url": "http://127.0.0.1:33907/index.html", "profile": "static"}
        assert (
            request("http://127.0.0.1:8083/api/v1/web/scrape", "POST", body)[0] == 401
        )
        assert (
            request(
                "http://127.0.0.1:8083/api/v1/web/scrape", "POST", body, backend_token
            )[0]
            == 401
        )
        status, payload = request(
            "http://127.0.0.1:8083/api/v1/web/scrape", "POST", body, public_token
        )
        assert status == 200 and b"Static release smoke" in payload
        page_url = "http://127.0.0.1:3007/api/v1/page?url=" + urllib.parse.quote(
            body["url"], safe=""
        )
        assert request(page_url)[0] == 401
        assert request(page_url, token=public_token)[0] == 401
        page_status, page_payload = request(page_url, token=backend_token)
        page = json.loads(page_payload)
        assert page_status == 200 and page.get("success") is True
        assert "Static release smoke" in page.get("data", {}).get("markdown", "")
        rag_db = temp_path / "ai-rag.sqlite"
        ingest = subprocess.run(
            [
                str(release / "bin/aphrody"),
                "rag",
                "--db",
                str(rag_db),
                "web-ingest",
                body["url"],
            ],
            cwd=temp_path,
            env={
                **base_env,
                "APHRODY_HOME": str(temp_path / "ai"),
                "APHRODY_WEB_API_URL": "http://127.0.0.1:3007",
                "APHRODY_WEB_API_TOKEN": backend_token,
            },
            capture_output=True,
            timeout=120,
            check=False,
        )
        assert ingest.returncode == 0 and rag_db.is_file(), (
            "packaged Aphrody CLI Web ingest failed"
        )
        no_token_ingest = subprocess.run(
            [
                str(release / "bin/aphrody"),
                "rag",
                "--db",
                str(temp_path / "no-token-rag.sqlite"),
                "web-ingest",
                body["url"],
            ],
            cwd=temp_path,
            env={
                **base_env,
                "APHRODY_HOME": str(temp_path / "ai"),
                "APHRODY_WEB_API_URL": "http://127.0.0.1:3007",
            },
            capture_output=True,
            timeout=120,
            check=False,
        )
        assert no_token_ingest.returncode != 0, (
            "Aphrody CLI Web ingest accepted a missing backend token"
        )
        body["url"] = "http://127.0.0.1:33907/render.html"
        body["profile"] = "render"
        status, payload = request(
            "http://127.0.0.1:8083/api/v1/web/scrape", "POST", body, public_token
        )
        assert status == 200 and b"Hydrated release smoke" in payload
        for name, proc in zip(SERVICES, procs, strict=True):
            assert proc.poll() is None, f"{name} exited during the smoke"
        print(
            "four services, Web auth/ingest, A2A, AI models, site static/render: ok"
        )
        if args.attest:
            attestation = {
                "schema": "aphrody-stack-smoke/v1",
                "status": "ok",
                "releaseId": (release / "RELEASE_ID").read_text().strip(),
                "sha256sums": hashlib.sha256(
                    (release / "SHA256SUMS").read_bytes()
                ).hexdigest(),
                "services": SERVICES,
                "checkedAt": datetime.datetime.now(datetime.UTC)
                .isoformat()
                .replace("+00:00", "Z"),
            }
            staged = args.attest.with_name(args.attest.name + ".tmp")
            staged.write_text(json.dumps(attestation, indent=2) + "\n")
            staged.replace(args.attest)
    except Exception:
        for name, log in logs:
            log.flush()
            data = Path(log.name).read_text(errors="replace")
            data = data.replace(public_token, "[REDACTED_SECRET]").replace(
                backend_token, "[REDACTED_SECRET]"
            )
            print(f"{name}: {data[-1000:]}", file=sys.stderr)
        raise
    finally:
        fixture.shutdown()
        for proc in procs:
            proc.terminate()
        for proc in procs:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
        log_stack.close()
