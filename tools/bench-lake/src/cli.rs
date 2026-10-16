//! The command: argument parsing and the canonical answer (lakelib.impl.rust).

use std::io::{self, Write};
use std::path::Path;

pub const EXIT_OK: i32 = 0;
pub const EXIT_QUESTION: i32 = 2;

pub const EXIT_NOT_RUN: i32 = 3;
pub const EXIT_DEFECT: i32 = 1;

/// Where `compare-git --report` puts its report. The library proper writes nothing; the program supplies the writer.
pub type ReportSink<'a> = &'a mut dyn FnMut(&Path, &str) -> io::Result<()>;

/// Runs the command; returns the exit code. `args` excludes the program name.
pub fn run(args: &[String], out: &mut dyn Write, err: &mut dyn Write, report: ReportSink) -> i32 {
    let _ = (args, out, err, report);
    todo!("cli::run")
}
