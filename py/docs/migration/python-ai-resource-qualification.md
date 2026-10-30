<!-- SPDX-License-Identifier: Apache-2.0 -->
# Training and fixture package resources

`aphrody-train` and `aphrody-embedding-fixtures` now preserve their source
Apache-2.0 license and notices in both wheels and sdists. Before this change,
the built training wheel had no license metadata or embedded license/notice.
Both owners now declare `License-Expression: Apache-2.0` and the two
`License-File` entries using
[Hatch's standard project metadata](https://hatch.pypa.io/latest/config/metadata/#license).

The files were copied unchanged from the committed Aphrody AI source revision
`4a9e529fb721d5fb7a0ba87313a98928c2ab47a5`. Their SHA256 values are:

| Source resource | SHA256 |
| --- | --- |
| `LICENSE` | `a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9` |
| `NOTICE` | `8ada1e46ed5127386bf3816ce54513f175de5890a167893303d0d88b44c766f0` |

The [qualification report](python-ai-resource-qualification.json) measures
committed Python clone `92dc9d6531ab0fdedb09b427de2f8d51b471cc0e`.
The reusable check builds each package independently outside the clone, verifies
the actual license metadata/resources and every wheel RECORD hash/size, checks
both sdists, and rebuilds their wheels directly from those archives. Direct and
rebuilt wheels are byte-identical with `SOURCE_DATE_EPOCH=1727740800`:

| Package | Direct and rebuilt wheel SHA256 |
| --- | --- |
| `aphrody-train` | `b5ff2e030e85f716b2fb577ba5b8052ec43b6b543ac55cfaa794978e1ca95a9b` |
| `aphrody-embedding-fixtures` | `6732138e19a5eee7c99532d6d83357799f094728c4629a90b5937928d64ce137` |

Run the same artifact and installation check:

```sh
uv run --no-project --python 3.12 python tools/packaging/qualify_ai_resources.py \
  --report /tmp/aphrody-ai-resource-qualification.json
```

A separate clean environment outside all source checkouts installs the locked,
hashed minimal dependencies and rebuilt wheels. `uv pip check` passes. Public
`GpuRagEngine`, `MultimodalDoc`, `EmbeddingFixtureGenerator` and
`RerankFixtureGenerator` imports resolve from the installed environment without
loading NumPy, torch or SentenceTransformers. Both fixture-generator CLI help
paths execute. These checks qualify redistribution of the measured code and
notices and minimal import behavior; they do not execute model generation,
training or CPU/CUDA extras.

No datasets, credentials, weights or synthetic replacement model fixtures were
added. The copied upstream notices remain intact; the first-party source license
does not relicense model assets or independent upstream components. Koharu's
distribution license provenance still requires its own source authority and was
not inferred from these AI packages.

The [SDK plan](../sdk/PLAN.md) and [root plan](../../../src/PLAN.md) retain the
broader optional-provider, platform and release gates.
