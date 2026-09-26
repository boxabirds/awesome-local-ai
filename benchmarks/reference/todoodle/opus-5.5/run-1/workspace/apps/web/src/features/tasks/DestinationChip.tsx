/** Where quick add puts the new task. Stories 7 and 8 add projects and Today. */
export type QuickAddTarget =
  | { kind: 'inbox' }
  | { kind: 'project'; id: string; name: string; color: string }
  | { kind: 'today' };

export function targetLabel(target: QuickAddTarget): string {
  switch (target.kind) {
    case 'inbox':
      return 'Inbox';
    case 'today':
      return 'Today';
    case 'project':
      return target.name;
  }
}

/**
 * A small, non-focusable chip: '→ Inbox' (or '→ {project}' with its colour dot, or '→ Today'). The quick
 * add form lists it in aria-describedby, so screen readers hear where the task goes.
 */
export function DestinationChip({ id, target }: { id: string; target: QuickAddTarget }) {
  return (
    <span id={id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
      {target.kind === 'project' ? (
        // A CSSOM style (allowed by the CSP), since the colour token is only known at runtime.
        <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: `var(--project-${target.color})` }} />
      ) : null}
      {`→ ${targetLabel(target)}`}
    </span>
  );
}
