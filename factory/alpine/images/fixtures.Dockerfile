# Builds and downloads the test programs (pinned sha256) into /out.
FROM base
RUN --mount=type=bind,from=repo,source=/repo,target=/repo \
    apk add --no-cache --repository /repo/bunos bunos-dotnet bunos-wasm && \
    apk add --no-cache mingw-w64-gcc gcc musl-dev curl unzip dpkg 7zip
COPY fixtures/ /src/
RUN sh /src/make.sh /out
CMD ["sh", "-c", "cp -r /out/. /fixtures/"]
