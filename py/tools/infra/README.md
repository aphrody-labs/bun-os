<!-- SPDX-License-Identifier: Apache-2.0 -->
# Infra Python tools

First-party operational scripts extracted from `aphrody-infra`. They run from
the shared workspace environment and keep their original command arguments:

```sh
uv run --locked --project py python py/tools/infra/scripts/install-developer-cli.py
```

`install-developer-cli.py` reads its catalog from the Infra checkout. Set
`APHRODY_INFRA_ROOT` when that checkout is not at the workstation default.

Do not run administrative commands as part of workspace validation.
