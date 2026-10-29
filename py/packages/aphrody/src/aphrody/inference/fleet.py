# SPDX-License-Identifier: Apache-2.0
"""Measured resource planning for the private Aphrody GPU fleet.

vLLM owns CUDA execution and distributed buffers. This owner plans heterogeneous
pipeline stages; it never pretends network memory is a local allocation.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from ipaddress import ip_address
from typing import Any


@dataclass(frozen=True)
class Node:
    member: str
    address: str
    gpu: str
    vram_mib: int
    free_vram_mib: int
    ram_bytes: int
    available_ram_bytes: int
    disk_bytes: int
    available_disk_bytes: int
    docker_cuda: bool

    @classmethod
    def parse(cls, value: dict[str, Any]) -> Node:
        node = cls(**value)
        if node.member not in {"aphro-pc", "omar"}:
            raise ValueError("unknown fleet member")
        expected = "10.200.77.4" if node.member == "aphro-pc" else "10.200.77.10"
        if str(ip_address(node.address)) != expected:
            raise ValueError("fleet address must be a declared private host")
        for total, free in (
            (node.vram_mib, node.free_vram_mib),
            (node.ram_bytes, node.available_ram_bytes),
            (node.disk_bytes, node.available_disk_bytes),
        ):
            if (
                type(total) is not int
                or type(free) is not int
                or not 0 <= free <= total
            ):
                raise ValueError("invalid measured resource counters")
        if type(node.docker_cuda) is not bool:
            raise ValueError("Docker CUDA requires an actual qualification result")
        return node


def pipeline_plan(
    nodes: list[Node], layers: int, reserve_mib: int = 2048
) -> dict[str, Any]:
    """Allocate every transformer layer once, weighted by measured free VRAM."""
    if len(nodes) != 2 or {n.member for n in nodes} != {"aphro-pc", "omar"}:
        raise ValueError("both distinct PC members are required")
    if type(layers) is not int or layers < 2:
        raise ValueError("model must expose at least two transformer layers")
    if type(reserve_mib) is not int or reserve_mib < 1024:
        raise ValueError("reserve at least one GiB per GPU for runtime and KV cache")
    # The larger stage is the driver, which also owns embeddings and the API.
    ordered = sorted(nodes, key=lambda n: n.free_vram_mib, reverse=True)
    budgets = [n.free_vram_mib - reserve_mib for n in ordered]
    if min(budgets) <= 0:
        raise ValueError("insufficient free VRAM after runtime reserve")
    first = max(1, min(layers - 1, math.floor(layers * budgets[0] / sum(budgets))))
    partition = [first, layers - first]
    return {
        "strategy": "pipeline",
        "tensor_parallel_size": 1,
        "pipeline_parallel_size": 2,
        "layer_partition": partition,
        "environment": {"VLLM_PP_LAYER_PARTITION": ",".join(map(str, partition))},
        "stages": [
            {"member": n.member, "layers": count, "usable_vram_mib": budget}
            for n, count, budget in zip(ordered, partition, budgets, strict=True)
        ],
        "resources": {
            "total_vram_mib": sum(n.vram_mib for n in nodes),
            "available_vram_mib": sum(n.free_vram_mib for n in nodes),
            "total_ram_bytes": sum(n.ram_bytes for n in nodes),
            "available_ram_bytes": sum(n.available_ram_bytes for n in nodes),
            "total_disk_bytes": sum(n.disk_bytes for n in nodes),
            "available_disk_bytes": sum(n.available_disk_bytes for n in nodes),
            "memory_semantics": "distributed allocations; not a coherent shared address space",
            "storage_semantics": "network artifact store plus verified local model caches",
        },
        "cuda_ready": all(n.docker_cuda for n in nodes),
        "missing_cuda": [n.member for n in nodes if not n.docker_cuda],
    }


def plan_json(argument: str) -> str:
    """Stable Python host call boundary (@aphrody/runtime-sdk/python); no provider credentials cross this API."""
    value = json.loads(argument)
    result = pipeline_plan(
        [Node.parse(n) for n in value["nodes"]],
        value["layers"],
        value.get("reserve_mib", 2048),
    )
    return json.dumps(result, allow_nan=False)


def cuda_probe_json(_argument: str = "") -> str:
    """Qualify real CUDA arithmetic, not just a driver or a visible device name."""
    import os

    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA execution is unavailable in this Python environment")
    result = []
    for index in range(torch.cuda.device_count()):
        with torch.cuda.device(index):
            sample = torch.arange(256, device=f"cuda:{index}", dtype=torch.float32)
            actual = float(torch.dot(sample, sample).item())
            torch.cuda.synchronize(index)
            expected = sum(i * i for i in range(256))
            if actual != expected:
                raise RuntimeError("CUDA arithmetic qualification failed")
            free, total = torch.cuda.mem_get_info(index)
            result.append(
                {
                    "index": index,
                    "name": torch.cuda.get_device_name(index),
                    "free_bytes": free,
                    "total_bytes": total,
                    "arithmetic_result": actual,
                }
            )
    return json.dumps({"pid": os.getpid(), "devices": result})


if __name__ == "__main__":
    import sys

    if sys.argv[1:] != ["cuda-probe"]:
        raise SystemExit("usage: fleet.py cuda-probe")
    print(cuda_probe_json())
