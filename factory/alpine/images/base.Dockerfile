FROM alpine:3.24.2
COPY --from=repo /keys/ /etc/apk/keys/
RUN --mount=type=bind,from=repo,source=/repo,target=/repo \
    apk add --no-cache --repository /repo/bunos bunos-base bunos-run
RUN echo "http://repo/bunos" > /etc/apk/bunos-repository
ENV PATH=/usr/bin:/bin:/usr/sbin:/sbin
