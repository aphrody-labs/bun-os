. /tests/lib.sh
check os-release bunos-alpine cat /etc/bunos-release
check alpine-3.24 3.24 cat /etc/alpine-release
check coreutils-is-uutils "uutils coreutils" cat --version
check coreutils-owner "uutils-coreutils" apk info -W /bin/cat
check sudo-is-rs "sudo-rs" sudo --version
check nushell "6" nu -c '[1 2 3] | math sum'
check ripgrep "bar" sh -c "printf 'foo\nbar\n' | rg bar"
check fd "fd " fd --version
check eza "eza" eza --version
check bat "bat " bat --version
check zoxide "zoxide" zoxide --version
check starship "starship" starship --version
check bun-version "1.4.4" bun --version
check bun-revision "11c3671" bun -e 'console.log(Bun.revision)'
check bun-run "42" bun -e 'console.log(6*7)'
check bun-sha256 "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" bun -e 'console.log(new Bun.CryptoHasher("sha256").update("abc").digest("hex"))'
check bun-serve "pong" bun -e 'const s=Bun.serve({port:0,fetch:()=>new Response("pong")});console.log(await (await fetch(`http://localhost:${s.port}`)).text());s.stop()'
apk del -q bunos-run
check apk-add-signed "bunos-run" apk add --no-cache --repository http://repo/bunos bunos-run
check dispatch-elf-musl "hello from bunos" bunos run /fixtures/hello-musl
check dispatch-js "42" sh -c 'echo "console.log(6*7)" > /tmp/a.ts && bunos run /tmp/a.ts'
check dispatch-alpine-apk "hello from the bunos-hello apk" sh -c 'cd /tmp && wget -q http://repo/bunos/x86_64/bunos-hello-1.0.0-r0.apk && bunos detect bunos-hello-1.0.0-r0.apk && bunos run bunos-hello-1.0.0-r0.apk >/dev/null && bunos-hello'
check dispatch-deb-glibc "Hello, world!" bunos run /fixtures/hello.deb
check dispatch-unknown "unknown file type" sh -c 'echo x > /tmp/x.bin; bunos run /tmp/x.bin 2>&1; test $? -eq 3'
finish
