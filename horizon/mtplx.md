# MTPLX

**Status:** blocked (29 Sep 2026; retired from runs since late Sep 2026). Its memory admission can deadlock a
long coding-agent conversation, and neither report has a fix yet.
**Machine:** quintus (M5 Max). mlx-serve replaced it as the MLX engine; it is not used as a baseline.
Three vidi runs exist under [mtplx-opencode](../combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/).

## Why it's blocked

1. **Compaction refused, conversation deadlocked** (MTPLX 2.12.0, 24 Sep 2026). When pi asked the model to
   summarise older history near the context limit, MTPLX refused every summary request with HTTP 507 (13 in a
   row) while it kept the long conversation's own KV in memory. The conversation could neither shrink nor
   continue (every further turn got 1 output token) until MTPLX was restarted.
   [Report sent to MTPLX's author](../docs/20260924-mtplx-memory-report.md).
2. **An idle session's KV blocks admission** (same incident, analysed 28 Sep 2026). Near the memory limit the
   admission shed can't evict an idle coding session's live KV, so a new request can be refused (507) on
   every retry. [Issue draft, not filed yet](../issues/external/20260928-mtplx-idle-session-kv-blocks-admission.md).
3. Earlier, on 2.11.1 (4 Sep 2026): long cold prefills emit nothing, so streaming clients disconnect; the
   SSD session cache served no restores while costing time.
   [Field notes](../docs/20260904-mtplx-feedback.md).

Every vidi story on quintus is one long agent conversation near the context limit, which is exactly where
1 and 2 happen: a stopped story would score what it had built so far, and look like a model result.

## What would unblock it

A release that fixes memory admission for long agent sessions (compaction requests admitted; idle-session KV
evictable), then:

1. The same long-context multi-turn test as [TensorFold](tensorfold.md) on quintus: a conversation grown past
   120k tokens, including a compaction request near the limit, answered without 507 and with the cache kept.
2. A one-story smoke test.

## Contact with the author

The owner pinged Youssof (MTPLX's author) about the report; no reply yet as of 29 Sep 2026. Earlier he said he
thinks 2.12 broke a few things and that **2.14** will be worth looking out for (the owner's account of that
conversation; 2.12.0 is the version these reports are on).

**Last checked:** 29 Sep 2026 (installed version 2.12.0). **Recheck when:** MTPLX 2.14 is released (then run
the checks above on it), or Youssof replies; and once the issue draft is filed, when it closes.
