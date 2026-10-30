//! wasm-bindgen surface used to qualify the `@aphrody/wasm` bindgen path.
use wasm_bindgen::prelude::*;

/// `Hello, <name>!`
pub fn greeting(name: &str) -> String {
    format!("Hello, {name}!")
}

#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    greeting(name)
}

#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}

#[cfg(test)]
mod tests {
    #[test]
    fn greets() {
        assert_eq!(super::greeting("Bun"), "Hello, Bun!");
    }
}
