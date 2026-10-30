<!-- SPDX-License-Identifier: Apache-2.0 -->
# Retired public static WebOS deployment

This short archive notice replaces the 2026-10-11 runbook. That runbook
described an allowlisted static demo at `/labs/webos/` and an apex site served
from DBFR. Both deployment paths were superseded when `aphrody.com` moved to the
native Bun WebOS service on the VPS on 2026-10-24. Its Cloudflare apex routes
were removed, and the old static-release Nginx include was retired.

For the current stack and activation flow, see the
[WebOS production guide](../../../../apps/webos/README.md). This notice is
historical; do not use its former release paths, DBFR ingress, or apply steps.
