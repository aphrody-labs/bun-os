FROM base
RUN --mount=type=bind,from=repo,source=/repo,target=/repo     apk add --no-cache --repository /repo/bunos bunos-wine
# A prefix created once at build time (wineboot), so tests measure the programs and not the first-run setup.
ENV XDG_RUNTIME_DIR=/tmp/xdg
RUN mkdir -m 700 /tmp/xdg
ENV WINEPREFIX=/root/.wine WINEDEBUG=-all
RUN xvfb-run -a wineboot --init && wineserver -w
