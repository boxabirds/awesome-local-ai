// Projects this tab already knows are gone (deleted here, or reported deleted by a live event). The project
// view uses it so that leaving a deleted project never also says 'Project not found'.

const gone = new Set<string>();

export function markProjectGone(id: string): void {
  gone.add(id);
}

/** A project came back (Undo). */
export function unmarkProjectGone(id: string): void {
  gone.delete(id);
}

export function isProjectGone(id: string): boolean {
  return gone.has(id);
}

/** Test helper. */
export function clearProjectGoneForTests(): void {
  gone.clear();
}
