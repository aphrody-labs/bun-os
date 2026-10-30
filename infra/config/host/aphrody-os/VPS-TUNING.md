<!-- SPDX-License-Identifier: Apache-2.0 -->

# Linux VPS performance tuning

Superseded by the applied configuration in [`docs/VPS-TUNING.md`](../../../../docs/VPS-TUNING.md): files under
`infra/config/host/vps/tuning/` and `infra/config/host/systemd/slices/`, each with an idempotent `apply.sh`. The earlier
proposal here (THP `always`, synchronous `discard`, tuned profiles) contradicted the live host and is not used.
