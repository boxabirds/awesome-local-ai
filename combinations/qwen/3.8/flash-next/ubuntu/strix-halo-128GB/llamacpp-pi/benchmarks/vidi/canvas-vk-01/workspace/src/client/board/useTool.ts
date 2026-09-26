/**
 * Shared pointer-tool helper. The active-tool state itself lives in
 * `src/client/tools/useActiveTool.ts` (stories 9-12 share it); this file keeps
 * the one predicate both that hook and the keyboard handler need.
 */

/** True when the key event belongs to a focused editable element. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
