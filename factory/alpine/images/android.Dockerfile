FROM base
RUN --mount=type=bind,from=repo,source=/repo,target=/repo     apk add --no-cache --repository /repo/bunos bunos-android
