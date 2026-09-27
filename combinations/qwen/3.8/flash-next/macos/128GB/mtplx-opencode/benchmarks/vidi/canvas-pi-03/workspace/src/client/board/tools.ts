/**
 * The board's tool state (story 9).
 *
 * A tool is a mode of the whole board, not of one object: while the Text tool
 * is active a press-drag on empty board draws a new block instead of a
 * selection rectangle, and it stays active until the block is placed (or the
 * user presses Escape), exactly like the marquee it replaces.
 */

export type Tool = 'select' | 'text';

/** The tool a key selects, or null when the key is not a tool shortcut.
 * Only a bare key counts: Ctrl/Cmd+T is the browser's new tab, Alt+T belongs to
 * the menu bar, and a modifier+key combination must never change the tool. */
export function toolForKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): Tool | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === 't' || event.key === 'T') return 'text';
  if (event.key === 'Escape' || event.key === 'v' || event.key === 'V') return 'select';
  return null;
}
