# SPDX-License-Identifier: Apache-2.0
"""Private, provenance-preserving Bun-fork specialization corpus."""

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

from .dataset import redact

SYSTEM = "You write native Bun TypeScript for the Aphrody Bun fork. Use Bun built-ins and Web APIs. Do not use Node.js APIs, npm, npx, or third-party replacements for Bun APIs. For requests unrelated to Bun programming, answer: I specialize in native Bun programming. Return runnable Bun code when asked to implement a program."
FORBIDDEN = re.compile(
    r"node:|\brequire\s*\(|\b(?:npm|npx|express|axios|child_process)\b"
)
BLOCK = re.compile(r"```(?:ts|typescript|js|javascript)(?:[^\n]*)\n(.*?)```", re.S)


def examples(path: str, text: str) -> list[dict]:
    rows = []
    for index, match in enumerate(BLOCK.finditer(text)):
        code = match.group(1).strip()
        if not 80 <= len(code) <= 5000 or "Bun." not in code or FORBIDDEN.search(code):
            continue
        if re.search(r"^\s*import.*?from\s*['\"](?!bun:|\.|/)", code, re.M):
            continue
        if redact({"code": code})["code"] != code:
            continue
        before = text[: match.start()]
        headings = re.findall(r"^#{1,4}\s+(.+)$", before, re.M)
        topic = headings[-1] if headings else Path(path).stem
        rows.append(
            {
                "source": path,
                "block": index,
                "text_sha256": hashlib.sha256(code.encode()).hexdigest(),
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {
                        "role": "user",
                        "content": f"Write a native Bun TypeScript example for {topic}. Use the API described in {path}.",
                    },
                    {"role": "assistant", "content": code},
                ],
            }
        )
    return rows


def build(fork: Path, output: Path) -> dict:
    if output.exists():
        raise ValueError("Corpus output must be a new private directory")
    revision = subprocess.check_output(
        ["git", "-C", str(fork), "rev-parse", "HEAD"], text=True
    ).strip()
    paths = subprocess.check_output(
        ["git", "-C", str(fork), "ls-files", "-z", "docs/runtime", "docs/api"],
        text=True,
    ).split("\0")
    splits: dict[str, list[dict]] = {"train": [], "eval": []}
    seen = set()
    sources = []
    for path in sorted(filter(None, paths)):
        if not path.endswith(".mdx"):
            continue
        # Read committed blobs, never concurrent edits or untracked protected files.
        text = subprocess.check_output(
            ["git", "-C", str(fork), "show", f"{revision}:{path}"], text=True
        )
        split = (
            "eval"
            if int(hashlib.sha256(path.encode()).hexdigest()[:8], 16) % 5 == 0
            else "train"
        )
        for row in examples(path, text):
            if row["text_sha256"] in seen:
                continue
            seen.add(row["text_sha256"])
            splits[split].append(row)
        sources.append(
            {
                "path": path,
                "sha256": hashlib.sha256(text.encode()).hexdigest(),
                "split": split,
            }
        )
    if not splits["train"] or not splits["eval"]:
        raise ValueError("Both training and untouched evaluation examples are required")
    # Explicit scope examples teach specialization; evaluation topics stay unseen.
    topics = {
        "train": [
            "Write a recipe for pancakes.",
            "Explain medieval history.",
            "Plan a holiday in Rome.",
            "Translate a poem into French.",
            "Give me gardening advice.",
            "Describe the solar system.",
            "Write a romantic story.",
            "Suggest a workout routine.",
            "Explain football rules.",
            "Design a clothing collection.",
            "Give stock market predictions.",
            "Compare classical painters.",
        ],
        "eval": [
            "How do I bake sourdough?",
            "Tell me about ancient Egypt.",
            "Recommend a yoga session.",
            "Summarize a detective novel.",
        ],
    }
    for split, prompts in topics.items():
        for prompt in prompts:
            splits[split].append(
                {
                    "source": "owner-bun-specialization-policy",
                    "kind": "scope-refusal",
                    "messages": [
                        {"role": "system", "content": SYSTEM},
                        {"role": "user", "content": prompt},
                        {
                            "role": "assistant",
                            "content": "I specialize in native Bun programming.",
                        },
                    ],
                }
            )
    output.mkdir(parents=True, mode=0o700)
    manifests = {}
    for split, rows in splits.items():
        payload = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
        target = output / f"{split}.jsonl"
        target.write_text(payload)
        target.chmod(0o600)
        manifests[split] = {
            "rows": len(rows),
            "sha256": hashlib.sha256(payload.encode()).hexdigest(),
        }
    manifest = {
        "fork_revision": revision,
        "splits": manifests,
        "sources": sources,
        "policy": SYSTEM,
        "license_source": "oven-sh/bun:LICENSE.md",
        "limits": "Documentation snippets are not independently executed programs; held-out executable task evaluation is required before deployment.",
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "manifest.json").chmod(0o600)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--fork", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = build(args.fork, args.output)
    print(
        json.dumps(
            {"fork_revision": result["fork_revision"], "splits": result["splits"]}
        )
    )
