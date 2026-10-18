use std::io::{self, Read, Write};
fn main() {
    let mut input = Vec::new();
    if let Err(e) = io::stdin()
        .take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut input)
    {
        eprintln!("{e}");
        std::process::exit(1)
    }
    if input.len() > 64 * 1024 * 1024 {
        eprintln!("Request too large");
        std::process::exit(1)
    }
    let response = earthforge_core::api::process(&input);
    if let Err(e) = io::stdout().write_all(&response) {
        eprintln!("{e}");
        std::process::exit(1)
    }
}
