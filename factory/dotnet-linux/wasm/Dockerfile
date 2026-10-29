# SPDX-License-Identifier: Apache-2.0
# Alpine 3.24.2 guest for container2wasm (x86_64, Bochs + Linux 6.1) carrying the musl .NET artifacts of the CI alpine job.
# Build context: payload/{hello-aot,hello-jit,dotnet,pwsh} (see .github/workflows/dotnet-linux.yml, job wasm-guest).
ARG PAYLOAD=aot
FROM alpine:3.24.2
RUN apk add --no-cache icu-libs krb5-libs libgcc libintl libssl3 libstdc++ tzdata zlib
# The guest has one emulated CPU: no server GC, no tiered PGO, invariant globalization (no ICU data load), small GC heap limit.
ENV DOTNET_ROOT=/opt/dotnet \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 \
    DOTNET_gcServer=0 \
    DOTNET_TieredPGO=0 \
    DOTNET_GCHeapHardLimit=0x20000000 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    POWERSHELL_TELEMETRY_OPTOUT=1 \
    POWERSHELL_UPDATECHECK=Off
COPY payload/ /opt/
