# syntax=docker/dockerfile:1
# Build from `bun-distribution stage` output, never from a live checkout.
FROM ubuntu:26.04 AS base
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgcc-s1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10000 bun \
    && useradd --uid 10000 --gid 10000 --create-home --shell /usr/sbin/nologin bun \
    && install -d -m 0700 -o bun -g bun /run/user/10000 \
    && install -d -o bun -g bun /work

FROM base AS payload
COPY runtime/ /opt/bun-os/runtime/
COPY sources/ /opt/bun-os/sources/
COPY wasm/ /opt/bun-os/wasm/
COPY product/ /opt/bun-os/product/
COPY product.receipt.json product.qualification.json /opt/bun-os/
COPY distribution.json /opt/bun-os/distribution.json
COPY sources.receipt.json /opt/bun-os/sources.receipt.json
COPY container/ /opt/bun-os/container/
RUN chmod 0755 /opt/bun-os/runtime/bun /opt/bun-os/container/bunos \
    && ln -s /opt/bun-os/runtime/bun /usr/local/bin/bun \
    && ln -s /opt/bun-os/container/bunos /usr/local/bin/bunos \
    && if [ -f /opt/bun-os/runtime/bun-cosmic ]; then \
         chmod 0755 /opt/bun-os/runtime/bun-cosmic \
         && ln -s /opt/bun-os/runtime/bun-cosmic /usr/local/bin/bun-cosmic; fi \
    && bun /opt/bun-os/container/qualify-image.ts \
    && getconf GNU_LIBC_VERSION > /opt/bun-os/runtime/libc-version.txt \
    && ldd /usr/local/bin/bun > /opt/bun-os/runtime/shared-libraries.txt \
    && ! grep -q 'not found' /opt/bun-os/runtime/shared-libraries.txt

FROM base AS cosmic-core
COPY --from=payload /usr/local/bin/ /usr/local/bin/
COPY --from=payload /opt/bun-os/ /opt/bun-os/
# Bootstrap the signed official Pop repository with its source-pinned public key.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && curl --fail --silent --show-error --location --connect-timeout 15 --max-time 60 \
       https://raw.githubusercontent.com/pop-os/keyring/356a75e405d00a23889998d2e8f2508a9e67b535/usr/share/keyrings/pop-archive-keyring.gpg \
       --output /usr/share/keyrings/pop-archive-keyring.gpg \
    && echo 'a228ba8145acf8c57afd44ad7e8eb2d11776b5a2ca5fe5174698110023952f07  /usr/share/keyrings/pop-archive-keyring.gpg' | sha256sum --check - \
    && echo 'deb [signed-by=/usr/share/keyrings/pop-archive-keyring.gpg] https://apt.pop-os.org/release resolute main' > /etc/apt/sources.list.d/pop-os-release.list \
    && printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d \
    && chmod 0755 /usr/sbin/policy-rc.d \
    && apt-get update \
    && bun /opt/bun-os/container/install-cosmic.ts perf \
    && apt-get install -y --no-install-recommends \
       dbus-x11 mesa-vulkan-drivers libgl1-mesa-dri libegl-mesa0 pipewire pipewire-pulse wireplumber \
    && apt-get purge -y curl \
    && rm -rf /var/lib/apt/lists/* /tmp/bun-os-cosmic-debs \
    && BUN_OS_PROFILE=perf bun /opt/bun-os/container/entrypoint.ts health
ENV HOME=/home/bun BUN_OS_ROOT=/opt/bun-os \
    XDG_RUNTIME_DIR=/run/user/10000 XDG_CURRENT_DESKTOP=COSMIC XDG_SESSION_DESKTOP=COSMIC

FROM cosmic-core AS perf
ARG DISTRIBUTION_VERSION
ARG SOURCE_REVISION
LABEL org.opencontainers.image.title="Bun OS perf COSMIC" \
    org.opencontainers.image.source="https://github.com/aphrody-labs/bun-os" \
    org.opencontainers.image.version=$DISTRIBUTION_VERSION \
    org.opencontainers.image.revision=$SOURCE_REVISION
ENV BUN_OS_PROFILE=perf
RUN dpkg-query -W -f='${Package}\t${Version}\n' > /opt/bun-os/runtime/os-packages.tsv
WORKDIR /work
USER 10000:10000
ENTRYPOINT ["/usr/local/bin/bun", "/opt/bun-os/container/entrypoint.ts"]
CMD ["cosmic"]

FROM cosmic-core AS full
ARG DISTRIBUTION_VERSION
ARG SOURCE_REVISION
LABEL org.opencontainers.image.title="Bun OS full COSMIC" \
    org.opencontainers.image.source="https://github.com/aphrody-labs/bun-os" \
    org.opencontainers.image.version=$DISTRIBUTION_VERSION \
    org.opencontainers.image.revision=$SOURCE_REVISION
RUN apt-get update \
    && bun /opt/bun-os/container/install-cosmic.ts full \
    && dpkg-query -W -f='${Package}\t${Version}\n' > /opt/bun-os/runtime/os-packages.tsv \
    && rm -rf /var/lib/apt/lists/* /tmp/bun-os-cosmic-debs \
    && BUN_OS_PROFILE=full bun /opt/bun-os/container/entrypoint.ts health
ENV BUN_OS_PROFILE=full
WORKDIR /work
USER 10000:10000
ENTRYPOINT ["/usr/local/bin/bun", "/opt/bun-os/container/entrypoint.ts"]
CMD ["cosmic"]
