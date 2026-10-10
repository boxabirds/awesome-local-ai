// Window keyboard commands for the board, moved out of BoardScreen's
// Delete/Enter effect: Ctrl/Cmd+A, Escape, arrow nudge, Delete/Backspace and
// Enter-to-edit for a single selected sticky.

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import { TOOL_SHORTCUTS, type ToolId } from '../tools/useActiveTool';
import type { Selection } from './useSelection';

// Only tools that exist as modes can be switched to (sticky is an instant
// create, and story 12's image tool opens the file picker instead of being
// a mode).
const SWITCHABLE_TOOLS: readonly ToolId[] = ['select', 'text', 'shape', 'connector', 'pen'];

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undoBoundary?(): void;
  undoShortcuts?: { undo(): void; redo(): void };
  // Story 9: V/T switch the board tool; N creates a sticky at the view centre.
  // Story 10 adds S (shape) and L (connector) through TOOL_SHORTCUTS.
  tool?: { setTool(tool: ToolId): void };
  onCreateSticky?(): void;
  // Story 12: I opens the image file picker (instant action, like N).
  onOpenImagePicker?(): void;
}

function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const o = optsRef.current;
      const { selection } = o;
      if (isTextTarget(e.target)) return; // caret and text editing stay local
      const editing = selection.editingId !== null;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        if (editing) return;
        e.preventDefault();
        selection.setMany(allObjectIds(o.snapshot), false);
        return;
      }
      if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        // Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo (undo.controls).
        // Focus in a text target never reaches here (early return above), so
        // a sticky being edited and foreign inputs keep their own behaviour.
        e.preventDefault();
        if (!o.canEdit) return;
        const redo =
          e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'));
        if (redo) o.undoShortcuts?.redo();
        else o.undoShortcuts?.undo();
        return;
      }
      if (editing) return; // Escape inside the editor is handled by the editor
      if (e.key === 'Escape') {
        // Escape always returns to the Select tool (text.tool_ui).
        o.tool?.setTool('select');
        if (selection.ids.size > 0) selection.clear();
        return;
      }
      if (!mod && !e.altKey && e.key.length === 1) {
        // Single-letter tool shortcuts from one table (v, t, s, l); N stays an
        // instant sticky create rather than a mode switch.
        const shortcut = TOOL_SHORTCUTS[e.key.toLowerCase()];
        if (shortcut === 'sticky') {
          o.onCreateSticky?.();
          return;
        }
        if (shortcut === 'image') {
          o.onOpenImagePicker?.();
          return;
        }
        if (shortcut !== undefined && SWITCHABLE_TOOLS.includes(shortcut)) {
          o.tool?.setTool(shortcut);
          return;
        }
      }
      if (selection.ids.size === 0) return;
      const arrow =
        e.key === 'ArrowLeft'
          ? { x: -1, y: 0 }
          : e.key === 'ArrowRight'
            ? { x: 1, y: 0 }
            : e.key === 'ArrowUp'
              ? { x: 0, y: -1 }
              : e.key === 'ArrowDown'
                ? { x: 0, y: 1 }
                : null;
      if (arrow !== null) {
        e.preventDefault(); // no page scroll, no board pan
        if (!o.canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of o.snapshot) {
          if (!selection.ids.has(obj.id)) continue;
          const b = objectBounds(obj);
          positions.set(obj.id, { x: b.x + arrow.x * step, y: b.y + arrow.y * step });
        }
        moveObjects(o.doc, positions);
        o.undoBoundary?.(); // each nudge is one undo step
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (!o.canEdit) return;
        o.undoBoundary?.();
        deleteObjects(o.doc, [...selection.ids]);
        o.undoBoundary?.(); // the delete is one undo step
        selection.clear();
        return;
      }
      if (e.key === 'Enter' && selection.ids.size === 1) {
        if (!o.canEdit) return;
        const id = [...selection.ids][0];
        const obj = o.snapshot.find((s) => s.id === id);
        if (obj && getObjectType(obj.type)?.editableText) {
          e.preventDefault();
          selection.startEdit(id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
