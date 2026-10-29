# syntax=docker/dockerfile:1
# GNU Bun release and native artifacts require Ubuntu 26.04 / glibc 2.43.
ARG BASE_IMAGE=ubuntu@sha256:88a381d5b5eeb2b35d3ad70925a362c37ce569daf43ede89ff818ec20e4d3794
ARG DOTNET_IMAGE=mcr.microsoft.com/dotnet/runtime@sha256:5b280fe869ce058778531aa13d9a3ddf1efa0e889524904753da6fc48aada91e
FROM ${DOTNET_IMAGE} AS managed-runtime
FROM ${BASE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libgcc-s1 libstdc++6 libicu78 libssl3t64 zlib1g libgssapi-krb5-2 \
    libx11-6 libice6 libsm6 libfontconfig1 libxrandr2 libxi6 libxcursor1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 iecode && useradd --uid 10001 --gid 10001 --create-home iecode
COPY --from=managed-runtime /usr/share/dotnet /usr/share/dotnet
COPY --chown=10001:10001 product/ /opt/iecode/
ENV PATH="/opt/iecode/bin:/usr/share/dotnet:$PATH" \
    DOTNET_ROOT=/usr/share/dotnet \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    APHRODY_PROFILE=ie \
    NIE_WIKI_DB=/var/lib/iecode/mirror.sqlite
WORKDIR /opt/iecode
USER 10001:10001
ENTRYPOINT ["/opt/iecode/bin/bun"]
CMD ["--version"]
