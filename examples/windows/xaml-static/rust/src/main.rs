// Prints "<path>\t<root element>\t<element count>" for every XAML file listed (one path per line) in argv[1].
use std::fs;

fn scan(text: &str) -> (String, usize) {
    let b = text.as_bytes();
    let (mut i, mut count, mut root) = (0usize, 0usize, String::new());
    let find = |from: usize, pat: &str| text[from..].find(pat).map(|p| p + from);
    while let Some(p) = text[i..].find('<').map(|p| p + i) {
        i = p;
        if text[i..].starts_with("<!--") { i = find(i + 4, "-->").map_or(b.len(), |e| e + 3); continue; }
        if text[i..].starts_with("<![CDATA[") { i = find(i, "]]>").map_or(b.len(), |e| e + 3); continue; }
        if text[i..].starts_with("<?") { i = find(i, "?>").map_or(b.len(), |e| e + 2); continue; }
        match b.get(i + 1) {
            Some(c) if c.is_ascii_alphabetic() || *c == b'_' => {
                let mut j = i + 1;
                while j < b.len() && !matches!(b[j], b' ' | b'\t' | b'\r' | b'\n' | b'/' | b'>') { j += 1; }
                if root.is_empty() { root = text[i + 1..j].to_string(); }
                count += 1;
                i = j;
            }
            _ => i += 1,
        }
    }
    (root, count)
}

fn main() {
    let list = fs::read_to_string(std::env::args().nth(1).expect("list file")).unwrap();
    for path in list.lines().filter(|l| !l.is_empty()) {
        let raw = fs::read_to_string(path).unwrap();
        let (root, count) = scan(raw.trim_start_matches('\u{feff}'));
        println!("{path}\t{root}\t{count}");
    }
}
