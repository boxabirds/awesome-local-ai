import type { Row, Story } from "../../shared/types.ts";

/** Coloured by the story's own held-out tests (the whole suite so far if that's all there is). */
function cellClass(s: Story): string {
  const passed = s.ownTotal !== null ? s.ownPassed : s.passed;
  const total = s.ownTotal !== null ? s.ownTotal : s.total;
  if (!total) return "";
  if (passed === total) return "c-ok";
  return (passed ?? 0) > 0 ? "c-part" : "c-bad";
}

function describe(s: Story): string {
  const parts = [
    s.ownTotal !== null ? `own tests ${s.ownPassed}/${s.ownTotal}` : "",
    s.total !== null ? `whole suite ${s.passed}/${s.total}` : "",
  ].filter(Boolean);
  return `story ${s.id}: ${s.title} — ${s.status}${parts.length ? `; ${parts.join(", ")}` : ""}`;
}

export function StoriesStrip({ row }: { row: Row }) {
  const cur = row.live?.status === "running" ? row.live.currentStory : null;
  const running = cur !== null && !row.stories.some((s) => s.id === String(cur));
  if (row.stories.length === 0 && !running) return <span className="wait">—</span>;
  return (
    <div className="strip">
      {row.stories.map((s) => <span key={s.id} className={`cell ${cellClass(s)}`} title={describe(s)} data-story={s.id} />)}
      {running ? <span className="cell c-run" title={`story ${cur}: running`} data-story={cur} /> : null}
    </div>
  );
}
