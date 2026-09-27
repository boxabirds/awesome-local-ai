/** Where a new task lands. Stories 7 and 8 add the project and today kinds. */
export type QuickAddTarget =
  | { kind: 'inbox' }
  | { kind: 'project'; id: string; name: string; color: string }
  | { kind: 'today' };

export function targetLabel(target: QuickAddTarget): string {
  switch (target.kind) {
    case 'inbox':
      return 'Inbox';
    case 'project':
      return target.name;
    case 'today':
      return 'Today';
  }
}

/**
 * Non-focusable "→ Inbox" (or "→ Work" with its colour dot, or "→ Today"). The form's
 * aria-describedby points here, so screen readers hear "Adding to Inbox".
 */
export function DestinationChip({ id, target }: { id: string; target: QuickAddTarget }) {
  return (
    <span id={id} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
      <span className="sr-only">Adding to </span>
      {target.kind === 'project' ? (
        <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: `var(--project-${target.color})` }} />
      ) : null}
      <span aria-hidden="true">→ </span>
      {targetLabel(target)}
    </span>
  );
}
