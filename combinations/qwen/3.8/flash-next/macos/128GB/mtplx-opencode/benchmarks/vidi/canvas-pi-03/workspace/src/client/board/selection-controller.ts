// Framework-free selection model for story 7.
//
// This owns the SET of selected ids plus the drag/marquee logic and does all
// bounds + hit-testing with plain number math, so it is unit-testable in Node
// with a Y.Doc and a fake PointerEvent. It never touches React state or the DOM.
//
// The single "selectedId" of earlier stories is a special case of a one-element
// selection set; `useSelection` still exposes `selectedId` (the primary id) so
// existing components keep working.

/** How a press resolves, decided from the hit test + modifiers. */
export type PressAction =
  | 'pan' // empty board: story-1 camera pan
  | 'marquee' // Shift + empty board: draw a selection rectangle
  | 'toggle' // Cmd/Ctrl/Shift + a note: add/remove it from the set
  | 'begin-drag' // press a note that is NOT already in the set: select only it, arm
  | 'start-drag'; // press a note already in the set: drag the whole set immediately

export interface SelectionSnapshot {
  ids: readonly string[];
}

/** A press's inputs, already converted to world coordinates by the caller. */
export interface PressInput {
  /** World-space pointer position. */
  point: { x: number; y: number };
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
  /** The id under the pointer, or null for empty board. */
  hitId: string | null;
}

export class SelectionController {
  /** The selected ids, in a stable insertion order. */
  private readonly selected = new Set<string>();
  /** The ids being dragged (equals the selection at drag start). */
  private dragIds: string[] = [];
  /** Whether a press has armed (below threshold) an on-canvas gesture. */
  private armed: 'move' | 'marquee' | null = null;

  /** Current selection as an array (new array each call). */
  getSelection(): string[] {
    return [...this.selected];
  }

  has(id: string): boolean {
    return this.selected.has(id);
  }

  /** The "primary" id: the last-selected one (null when empty). Kept so callers
   * that only understood a single selection still have a sane value. */
  primary(): string | null {
    let last: string | null = null;
    for (const id of this.selected) last = id;
    return last;
  }

  /** Replace the whole selection. */
  setSelection(ids: Iterable<string>): void {
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
  }

  clear(): void {
    this.selected.clear();
    this.dragIds = [];
    this.armed = null;
  }

  /** Add `id` to the set, or remove it if it is already selected (toggle). */
  private toggle(id: string): void {
    if (this.selected.has(id)) {
      this.selected.delete(id);
      return;
    }
    this.selected.add(id);
  }

  /** Decide what a press means, without touching the selection yet. */
  classifyPress(input: PressInput): PressAction {
    const modifier = input.shift || input.meta || input.ctrl;
    if (input.hitId === null) {
      return input.shift ? 'marquee' : 'pan';
    }
    if (modifier) return 'toggle';
    if (this.selected.has(input.hitId)) return 'start-drag';
    return 'begin-drag';
  }

  /**
   * Handle a pointer-down. Returns the action taken. This is the only place the
   * selection set is mutated during a press; a plain click on empty board clears
   * it (a drag on empty board also clears it once it exceeds the threshold, via
   * the marquee path).
   */
  press(input: PressInput): { action: PressAction; selection: string[] } {
    const action = this.classifyPress(input);
    switch (action) {
      case 'pan':
        this.clear();
        break;
      case 'marquee':
        this.clear();
        this.armed = 'marquee';
        break;
      case 'toggle':
        if (input.hitId) this.toggle(input.hitId);
        this.armed = null;
        break;
      case 'begin-drag':
        // A press on a note that is not in the set selects ONLY it.
        this.setSelection([input.hitId!]);
        this.armed = 'move';
        break;
      case 'start-drag':
        this.dragIds = this.getSelection();
        this.armed = 'move';
        break;
    }
    return { action, selection: this.getSelection() };
  }

  /** Ids that a move of the currently-dragged object should move together. */
  dragSet(): string[] {
    return this.armed === 'move' ? [...this.dragIds] : [];
  }

  /** Apply a marquee result. With `additive` (Shift held) the hit ids are UNIONED
   * into the current set; otherwise they REPLACE it. Returns the new selection. */
  applyMarquee(ids: Iterable<string>, additive: boolean): string[] {
    if (!additive) this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.armed = null;
    return this.getSelection();
  }

  /** Clear the armed gesture flag (called on pointer-up). */
  release(): void {
    this.armed = null;
    this.dragIds = [];
  }
}