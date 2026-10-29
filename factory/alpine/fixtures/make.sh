#!/bin/sh
# Test programs. Downloads are pinned by sha256 (see pins.json "fixtures").
set -eu
out=$1; mkdir -p "$out"; cd /src
x86_64-w64-mingw32-gcc -O2 -o "$out/hello.exe" hello.c
gcc -O2 -o "$out/hello-musl" hello.c
# wasm32-wasip1: the wasi-sdk apk ships the clang config for this triple, wasi-libc the sysroot
clang --target=wasm32-unknown-wasip1 -O2 -o "$out/hello.wasm" hello.c
# managed assembly (framework-dependent, portable across Windows/Linux)
mkdir -p /tmp/cs && cd /tmp/cs
cp /src/Hello.cs Program.cs
cat > hello.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><UseAppHost>false</UseAppHost><AssemblyName>hello-managed</AssemblyName></PropertyGroup></Project>
XML
dotnet build -c Release -o "$out/managed" 2>&1 | tail -3
cp "$out/managed/hello-managed.dll" "$out/hello-managed.dll"
cp "$out/managed/hello-managed.runtimeconfig.json" "$out/"
fetch() { # url sha256 file
  curl -fsSL -o "$3" "$1"; echo "$2  $3" | sha256sum -c -
}
fetch "$(sed -n 's/^7ZR_URL=//p' /src/pins.env)" "$(sed -n 's/^7ZR_SHA256=//p' /src/pins.env)" "$out/7zr.exe"
fetch "$(sed -n 's/^7ZA_URL=//p' /src/pins.env)" "$(sed -n 's/^7ZA_SHA256=//p' /src/pins.env)" "$out/7z-extra.7z"
fetch "$(sed -n 's/^PYEMBED_URL=//p' /src/pins.env)" "$(sed -n 's/^PYEMBED_SHA256=//p' /src/pins.env)" "$out/python-embed.zip"
fetch "$(sed -n 's/^HELLO_DEB_URL=//p' /src/pins.env)" "$(sed -n 's/^HELLO_DEB_SHA256=//p' /src/pins.env)" "$out/hello.deb"
fetch "$(sed -n 's/^ANDROID_APK_URL=//p' /src/pins.env)" "$(sed -n 's/^ANDROID_APK_SHA256=//p' /src/pins.env)" "$out/clipboardeditor.apk"
7zz e -y -o"$out" "$out/7z-extra.7z" x64/7za.exe >/dev/null && rm "$out/7z-extra.7z"
cd "$out" && unzip -q python-embed.zip -d python-embed && rm python-embed.zip
ls -l "$out"
