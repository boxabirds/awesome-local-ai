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
import { getObjectType } from "../objects/registry";
import type { Tool } from "./useTool";
import type { SelectionApi } from "./useSelection";
import type { UndoController } from "./undo";

/**
 * The board's selection keyboard (`sel.keyboard`).
 *
 * Ctrl/Cmd+A selects everything this board can select, Escape clears the
 * selection, the arrows nudge it (1 board unit, 10 with Shift) and
 * Delete/Backspace remove it. Story 2's Enter-to-edit stays, and story 8 adds
 * Ctrl/Cmd+Z to undo this tab's last step, Ctrl/Cmd+Shift+Z (and Ctrl+Y) to redo
 * it, with a step boundary around every keyboard change. Story 9 adds the tool
 * keys: V and T switch between Select and Text, Escape leaves the Text tool, and
 * N creates a sticky note (the same thing the toolbar button does).
 *
 * Story 8's shortcuts are refused exactly where the design says: while focus is
 * in an ordinary field (the share-link input, a note's own text editor, which
 * handles Ctrl/Cmd+Z itself) and while this board may not be written to.
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
  /**
   * Story 8: this tab's undo history. Without it the undo and redo keys do
   * nothing, which is also how a board with no history behaves.
   */
  undo?: UndoController;
  /**
   * Story 9: the board's tool. V and T switch it, Escape leaves the Text tool.
   * Without it those keys do nothing.
   */
  tool?: { tool: Tool; setTool(tool: Tool): void };
  /** Story 9's `N`: the same thing the toolbar's Sticky note button does. */
  onCreateSticky?(): void;
}

/** What a handled key does. `null` leaves the key to the browser. */
export type BoardKeyCommand =
  | { type: "selectAll" }
  | { type: "clear" }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "delete" }
  | { type: "edit" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "tool"; tool: Tool }
  | { type: "createSticky" };

/** The pure half of the keyboard: what a key means, given the board's state. */
export function boardKeyCommand(
  event: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  },
  state: {
    hasSelection: boolean;
    isEditing: boolean;
    isTypingTarget: boolean;
    isButtonTarget: boolean;
    /** Story 9: the active tool, 'select' when the board has no tool state. */
    tool?: Tool;
  },
): BoardKeyCommand | null {
  if (state.isTypingTarget) return null;
  // While an object is being typed into, the keys belong to that text.
  if (state.isEditing) return null;

  const mod = event.ctrlKey || event.metaKey;

  if (mod && (event.key === "a" || event.key === "A")) return { type: "selectAll" };

  // Story 8: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl+Y redo. (Cmd+Y stays
  // the browser's own — only Ctrl+Y means redo here.)
  if (mod && (event.key === "z" || event.key === "Z")) {
    return event.shiftKey ? { type: "redo" } : { type: "undo" };
  }
  if (event.ctrlKey && !event.metaKey && (event.key === "y" || event.key === "Y")) {
    return { type: "redo" };
  }

  if (event.key === "Escape") {
    // Story 9: Escape leaves the Text tool without creating anything.
    if (state.tool !== undefined && state.tool !== "select") return { type: "tool", tool: "select" };
    return state.hasSelection || state.isEditing ? { type: "clear" } : null;
  }

  // Story 9's tool keys, plain keys only: Ctrl/Cmd+T and Alt+T stay the
  // browser's own.
  if (!mod && !event.altKey) {
    if (event.key === "v" || event.key === "V") {
      return state.tool !== undefined && state.tool !== "select" ? { type: "tool", tool: "select" } : null;
    }
    if (event.key === "t" || event.key === "T") {
      return state.tool !== undefined && state.tool !== "text" ? { type: "tool", tool: "text" } : null;
    }
    if (event.key === "n" || event.key === "N") return { type: "createSticky" };
  }

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
      const { doc, selection, snapshot, selectableTypes, canEdit, marquee, undo, tool, onCreateSticky } =
        latest.current;

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
        tool: tool?.tool,
      });
      if (!command) return;

      // Nothing may be written to a board that failed to load. Leaving a tool is
      // not a write, so it stays available.
      if (!canEdit && !isReadOnly(command)) return;

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
        case "tool": {
          event.preventDefault();
          tool?.setTool(command.tool);
          return;
        }
        case "createSticky": {
          // preventDefault: 'n' is a board command here, not a browser shortcut.
          event.preventDefault();
          onCreateSticky?.();
          return;
        }
        case "nudge": {
          // preventDefault: no page scroll, and the board does not pan (TC-34).
          event.preventDefault();
          // One nudge is one undo step, whatever happened just before it.
          undo?.boundary();
          nudge(doc, snapshot, selection.ids, command.dx, command.dy);
          undo?.boundary();
          return;
        }
        case "delete": {
          event.preventDefault();
          // A whole selection deleted by one key is one step, not one per object.
          undo?.boundary();
          deleteObjects(doc, Array.from(selection.ids));
          undo?.boundary();
          selection.clear();
          return;
        }
        case "undo": {
          event.preventDefault();
          undo?.undo();
          return;
        }
        case "redo": {
          event.preventDefault();
          undo?.redo();
          return;
        }
        case "edit": {
          const id = singleEditableObject(snapshot, selection.ids);
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

/**
 * Enter-to-edit (story 2): exactly one selected object, and only a type the
 * registry says holds text. Story 9 made this generic rather than sticky-only,
 * so a text object behaves exactly like a note here.
 */
function singleEditableObject(snapshot: readonly ObjectSnapshot[], ids: ReadonlySet<string>): string | null {
  if (ids.size !== 1) return null;
  const id = Array.from(ids)[0];
  if (id === undefined) return null;
  const object = snapshot.find((entry) => entry.id === id);
  if (!object) return null;
  return getObjectType(object.type)?.editableText === true ? object.id : null;
}

/** Commands that change no board content, and so survive `canEdit: false`. */
function isReadOnly(command: BoardKeyCommand): boolean {
  return (
    command.type === "selectAll" ||
    command.type === "clear" ||
    (command.type === "tool" && command.tool === "select")
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
