use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let stdout = std::io::stdout();
    let stderr = std::io::stderr();
    let code = bench_lake::cli::run(&args, &mut stdout.lock(), &mut stderr.lock());
    let _ = std::io::stdout().flush();
    std::process::exit(code);
}
