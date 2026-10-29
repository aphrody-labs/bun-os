. /tests/lib.sh
check rustc "rustc 1." rustc --version
check cargo-build "hello from cargo" sh -c 'cd /tmp && cargo new --quiet h && cd h && echo "fn main(){println!(\"hello from cargo\")}" > src/main.rs && cargo run -q'
check rust-wasm-build "" sh -c 'cd /tmp/h && cargo build -q --target wasm32-wasip1 && test -f target/wasm32-wasip1/debug/h.wasm'
check dispatch-built-wasm "hello from cargo" sh -c 'apk add -q wasmtime >/dev/null; bunos run --engine bun /tmp/h/target/wasm32-wasip1/debug/h.wasm'
finish
