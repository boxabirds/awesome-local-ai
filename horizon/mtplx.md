# MTPLX

**Status:** eliminated (retired, Sep 2026).
**Machine:** quintus (M5 Max). Replaced by mlx-serve as the MLX engine; not used as a baseline.

## Why

MTPLX 2.12.0 refused a coding agent's compaction requests with HTTP 507 while it kept the long conversation's
KV in memory, so the conversation could neither shrink nor continue until the server was restarted. Details:
[the report sent to its author](../docs/20260924-mtplx-memory-report.md) and
[earlier feedback](../docs/20260904-mtplx-feedback.md). Three vidi runs exist under
[mtplx-opencode](../combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/).

**Recheck when:** a release fixes memory admission for long agent sessions; then it needs the same
long-context multi-turn test as [TensorFold](tensorfold.md).
