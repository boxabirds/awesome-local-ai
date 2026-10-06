import { useEffect, useRef } from "react";
import type * as Y from "yjs";
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from "../../shared/board-model";
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from "../../shared/config";
import type { Point } from "../../shared/geometry";
import type { SelectionApi } from "./useSelection";

/**
 * The board's selection keyboard (`sel.keyboard`).
 *
 * Ctrl/Cmd+A selects everything this board can select, Escape clears the
 * selection, the arrows nudge it (1 board unit, 10 with Shift) and
 * Delete/Backspace remove it. Story 2's Enter-to-edit stays.
 *
 * Keys are refused while a person is typing — `editingId` is set or the focus is
 * in a field or a button — so Backspace edits text instead of deleting the
 * object around it (TC-30). Handled keys call `preventDefault`, which is what
 * keeps the page from scrolling and the arrows from being swallowed by the
 * browser's own text selection (TC-34).
 */

export interface BoardKeyOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  /** Types this board can select (its registry), so select-all skips unknown ones. */
  selectableTypes?: readonly string[];
  /** False when this board could not be loaded (story 4). */
  canEdit: boolean;
  /**
   * The Shift+drag selection rectangle. While it is being dragged, Escape cancels
   * the marquee and leaves the previous selection alone.
   */
  marquee?: { active(): boolean; cancel(): void };
}

/** What a handled key does. `null` leaves the key to the browser. */
export type BoardKeyCommand =
  | { type: "selectAll" }
  | { type: "clear" }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "delete" }
  | { type: "edit" };

/** The pure half of the keyboard: what a key means, given the board's state. */
export function boardKeyCommand(
  event: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  },
  state: { hasSelection: boolean; isEditing: boolean; isTypingTarget: boolean; isButtonTarget: boolean },
): BoardKeyCommand | null {
  if (state.isTypingTarget) return null;
  // While an object is being typed into, the keys belong to that text.
  if (state.isEditing) return null;

  const mod = event.ctrlKey || event.metaKey;

  if (mod && (event.key === "a" || event.key === "A")) return { type: "selectAll" };
  if (event.key === "Escape") return state.hasSelection || state.isEditing ? { type: "clear" } : null;

  const arrow = ARROW_DELTAS[event.key];
  if (arrow) {
    if (!state.hasSelection) return null;
    const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
    return { type: "nudge", dx: arrow.x * step, dy: arrow.y * step };
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    return state.hasSelection ? { type: "delete" } : null;
  }

  if (event.key === "Enter") {
    // A focused button handles its own Enter (story 2).
    if (state.isButtonTarget || !state.hasSelection) return null;
    return { type: "edit" };
  }

  return null;
}

const ARROW_DELTAS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function useBoardKeys(options: BoardKeyOptions): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { doc, selection, snapshot, selectableTypes, canEdit, marquee } = latest.current;

      // Mid-marquee, Escape belongs to the marquee: cancel it, keep the selection.
      if (event.key === "Escape" && marquee?.active()) {
        marquee.cancel();
        event.preventDefault();
        return;
      }

      const command = boardKeyCommand(event, {
        hasSelection: selection.ids.size > 0,
        isEditing: selection.editingId !== null,
        isTypingTarget: isTypingTarget(event.target),
        isButtonTarget: event.target instanceof HTMLElement && event.target.tagName === "BUTTON",
      });
      if (!command) return;

      // Nothing may be written to a board that failed to load.
      if (!canEdit && command.type !== "selectAll" && command.type !== "clear") return;

      switch (command.type) {
        case "selectAll": {
          // preventDefault: the browser must not select the page's text instead.
          event.preventDefault();
          selection.selectAll(allObjectIds(snapshot, selectableTypes));
          return;
        }
        case "clear": {
          event.preventDefault();
          selection.clear();
          return;
        }
        case "nudge": {
          // preventDefault: no page scroll, and the board does not pan (TC-34).
          event.preventDefault();
          nudge(doc, snapshot, selection.ids, command.dx, command.dy);
          return;
        }
        case "delete": {
          event.preventDefault();
          deleteObjects(doc, Array.from(selection.ids));
          selection.clear();
          return;
        }
        case "edit": {
          const id = singleSelectedSticky(snapshot, selection.ids);
          if (id === null) return;
          event.preventDefault();
          selection.startEdit(id);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Moves the whole selection by one nudge step, in absolute positions. */
function nudge(doc: Y.Doc, snapshot: readonly ObjectSnapshot[], ids: ReadonlySet<string>, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const positions = new Map<string, Point>();
  for (const object of snapshot) {
    if (!ids.has(object.id)) continue;
    const box = objectBounds(object);
    positions.set(object.id, { x: box.x + dx, y: box.y + dy });
  }
  moveObjects(doc, positions);
}

/** Story 2's Enter-to-edit: only ever for exactly one selected sticky note. */
function singleSelectedSticky(snapshot: readonly ObjectSnapshot[], ids: ReadonlySet<string>): string | null {
  if (ids.size !== 1) return null;
  const id = Array.from(ids)[0];
  if (id === undefined) return null;
  const object = snapshot.find((entry) => entry.id === id);
  return object && object.type === "sticky" ? object.id : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
