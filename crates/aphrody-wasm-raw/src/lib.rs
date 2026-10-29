//! A module without wasm-bindgen: exports `add`, `fib` and its memory, imports nothing.

/// Wrapping 32-bit addition.
#[unsafe(no_mangle)]
pub extern "C" fn add(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}

/// Iterative Fibonacci, wrapping on overflow.
#[unsafe(no_mangle)]
pub extern "C" fn fib(n: u32) -> u64 {
    let (mut a, mut b) = (0u64, 1u64);
    for _ in 0..n {
        let next = a.wrapping_add(b);
        a = b;
        b = next;
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_and_wraps() {
        assert_eq!(add(2, 3), 5);
        assert_eq!(add(i32::MAX, 1), i32::MIN);
    }

    #[test]
    fn fibonacci() {
        assert_eq!(fib(10), 55);
        assert_eq!(fib(90), 2_880_067_194_370_816_120);
    }
}
