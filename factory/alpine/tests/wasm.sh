. /tests/lib.sh
check wasmtime "wasmtime" wasmtime --version
check wasm-tools "wasm-tools" wasm-tools --version
check wasm-validate "" wasm-tools validate /fixtures/hello.wasm
check wasm-opt "" sh -c 'wasm-opt -O2 /fixtures/hello.wasm -o /tmp/o.wasm && wasm-tools validate /tmp/o.wasm'
check dispatch-wasmtime "hello from bunos" bunos run /fixtures/hello.wasm
check dispatch-bun-wasi "hello from bunos" bunos run --engine bun /fixtures/hello.wasm
check dispatch-optimized "hello from bunos" bunos run /tmp/o.wasm
finish
