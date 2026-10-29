# Builds the signed bunos APK repository with abuild. The signing key is generated here and thrown away with the
# builder stage (never committed); only the public key and the repository leave it.
FROM alpine:3.24.2 AS build
RUN apk add --no-cache alpine-sdk sudo
RUN adduser -D builder && addgroup builder abuild && echo 'builder ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/builder
USER builder
WORKDIR /home/builder/aports/bunos
COPY --chown=builder aports/bunos/ ./
COPY --from=bunosrun --chown=builder bunos.ts bunos-run/bunos.ts
RUN abuild-keygen -a -i -n -q
RUN set -e; ulimit -n 1024; for d in bun bunos-base bunos-run bunos-rust bunos-wasm bunos-hello bunos-wine bunos-dotnet bunos-android; do \
      cd $d; [ $d = bun ] || abuild checksum; abuild -d; cd ..; done
RUN ls -l ~/packages/bunos/x86_64/ && mkdir -p /home/builder/out/keys && cp ~/.abuild/*.pub /home/builder/out/keys/ \
 && cp -r ~/packages/bunos /home/builder/out/bunos

FROM alpine:3.24.2
COPY --from=build /home/builder/out/keys /keys
COPY --from=build /home/builder/out/bunos /repo/bunos
