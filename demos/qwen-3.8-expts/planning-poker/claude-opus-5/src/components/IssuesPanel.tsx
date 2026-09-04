import { useState } from "react";
import type { Issue } from "../../shared/protocol";
import { parseIssues } from "../lib/csv";

interface Props {
  issues: Issue[];
  activeIssueId: string | null;
  canManage: boolean;
  revealed: boolean;
  onAdd: (issues: Array<{ key: string | null; title: string }>) => void;
  onRemove: (issueId: string) => void;
  onSetActive: (issueId: string) => void;
  onCommit: () => void;
}

function toCsv(issues: Issue[]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = issues.map((i) =>
    [escape(i.key ?? ""), escape(i.title), escape(i.estimate ?? "")].join(","),
  );
  return ["Key,Summary,Estimate", ...rows].join("\n");
}

export function IssuesPanel({
  issues,
  activeIssueId,
  canManage,
  revealed,
  onAdd,
  onRemove,
  onSetActive,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const estimated = issues.filter((i) => i.estimate !== null).length;

  const submitDraft = () => {
    const parsed = parseIssues(draft);
    if (parsed.length === 0) return;
    onAdd(parsed);
    setDraft("");
    setAdding(false);
  };

  const download = () => {
    const blob = new Blob([toCsv(issues)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "estimates.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="flex w-full flex-col gap-3 rounded-2xl border border-ink-800 bg-ink-900/70 p-4 lg:w-80">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-100">Backlog</h2>
        <span className="text-[0.7rem] tabular-nums text-ink-400">
          {estimated}/{issues.length} estimated
        </span>
      </header>

      {issues.length === 0 ? (
        <p className="text-xs leading-relaxed text-ink-400">
          Nothing queued. Paste a list of tickets and the room will walk through them one at a
          time, recording each estimate as you go.
        </p>
      ) : (
        <ol className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
          {issues.map((issue) => {
            const active = issue.id === activeIssueId;
            return (
              <li key={issue.id}>
                <div
                  className={`group flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                    active
                      ? "border-amber-brand/60 bg-amber-brand/10"
                      : "border-transparent hover:border-ink-700 hover:bg-ink-850"
                  }`}
                >
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => onSetActive(issue.id)}
                    className="focus-ring flex-1 text-left disabled:cursor-default"
                  >
                    {issue.key && (
                      <span className="mr-1.5 font-mono text-[0.65rem] text-ink-400">
                        {issue.key}
                      </span>
                    )}
                    <span className="text-xs text-ink-100">{issue.title}</span>
                  </button>

                  {issue.estimate !== null && (
                    <span className="rounded bg-teal-brand/15 px-1.5 py-0.5 text-[0.7rem] font-semibold tabular-nums text-teal-brand">
                      {issue.estimate}
                    </span>
                  )}

                  {canManage && (
                    <button
                      type="button"
                      onClick={() => onRemove(issue.id)}
                      aria-label={`Remove ${issue.title}`}
                      className="focus-ring text-ink-600 opacity-0 transition group-hover:opacity-100 hover:text-rose-brand"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {canManage && revealed && activeIssueId && (
        <button
          type="button"
          onClick={onCommit}
          className="focus-ring rounded-lg bg-teal-brand/90 px-3 py-2 text-xs font-semibold text-ink-950 transition hover:bg-teal-brand"
        >
          Save estimate and take the next ticket
        </button>
      )}

      {canManage &&
        (adding ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              autoFocus
              placeholder={"One per line, or paste CSV:\nPROJ-14, Rework the import job"}
              className="focus-ring w-full resize-y rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-2 text-xs text-ink-100 placeholder:text-ink-600"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitDraft}
                className="focus-ring flex-1 rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-white"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setDraft("");
                }}
                className="focus-ring rounded-lg px-3 py-1.5 text-xs text-ink-400 hover:text-ink-100"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="focus-ring flex-1 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
            >
              Add tickets
            </button>
            {issues.length > 0 && (
              <button
                type="button"
                onClick={download}
                className="focus-ring rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
              >
                Export
              </button>
            )}
          </div>
        ))}
    </aside>
  );
}
