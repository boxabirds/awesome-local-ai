import { useState } from "react";
import type { FormEvent } from "react";
import type { GameState, Issue } from "../../../src/types";
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from "../../../src/rules";

const STATUS_ICON: Record<Issue["status"], string> = {
  pending: "○",
  voting: "▶",
  revealed: "❓",
  done: "✓",
  skipped: "–",
};

interface Props {
  state: GameState;
  isFacilitator: boolean;
  onStart: (issueId: string) => void;
  onAdd: (title: string, description: string) => void;
  onRemove: (issueId: string) => void;
}

export default function IssuesPanel({ state, isFacilitator, onStart, onAdd, onRemove }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  function canStart(issue: Issue): boolean {
    return (
      isFacilitator &&
      state.phase === "waiting" &&
      issue.status !== "voting" &&
      issue.status !== "revealed"
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    onAdd(t, description);
    setTitle("");
    setDescription("");
    setFormOpen(false);
  }

  return (
    <aside className="panel issues">
      <div className="issues-head">
        <h2>Issues</h2>
        {isFacilitator && (
          <button
            className="btn btn-ghost btn-small"
            onClick={() => setFormOpen((v) => !v)}
            disabled={state.phase === "voting"}
          >
            {formOpen ? "Cancel" : "+ Add"}
          </button>
        )}
      </div>

      {isFacilitator && formOpen && (
        <form className="add-issue" onSubmit={submit}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Issue title"
            maxLength={MAX_TITLE_LENGTH}
            autoFocus
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            maxLength={MAX_DESCRIPTION_LENGTH}
          />
          <button className="btn btn-primary" type="submit">
            Add issue
          </button>
        </form>
      )}

      <ul className="issue-list">
        {state.issues.length === 0 && (
          <li className="issue-empty">
            No issues yet{isFacilitator ? " — add one above" : ""}.
          </li>
        )}
        {state.issues.map((issue) => (
          <li
            key={issue.id}
            className={`issue ${issue.id === state.currentIssueId ? "issue-active" : ""} ${
              canStart(issue) ? "issue-clickable" : ""
            }`}
            onClick={() => {
              if (canStart(issue)) onStart(issue.id);
            }}
            title={issue.description || undefined}
          >
            <span className={`issue-status issue-status-${issue.status}`}>
              {STATUS_ICON[issue.status]}
            </span>
            <span className="issue-title">{issue.title}</span>
            {issue.estimate !== null && <span className="issue-estimate">{issue.estimate}</span>}
            {isFacilitator && state.phase === "waiting" && issue.id !== state.currentIssueId && (
              <button
                className="issue-remove"
                aria-label={`Remove ${issue.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(issue.id);
                }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="roster">
        <h3>Players</h3>
        <ul>
          {Object.values(state.players).map((p, i) => (
            <li key={p.id}>
              <span
                className="dot"
                style={{ background: `hsl(${(i * 137) % 360} 65% 60%)` }}
              />
              {p.name}
              {p.id === state.facilitatorId ? " (facilitator)" : ""}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
