//! The command: argument parsing and the canonical answer (lakelib.impl.rust).

use std::io::Write;

pub const EXIT_OK: i32 = 0;
pub const EXIT_QUESTION: i32 = 2;

/// Runs the command; returns the exit code. `args` excludes the program name.
pub fn run(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let _ = (args, out, err);
    todo!("cli::run")
}
