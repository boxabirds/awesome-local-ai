import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType, isRegisteredType } from '../objects/registry';
import { undoKey } from './undo';
import type { Selection } from './useSelection';
import { MODE_TOOLS, TOOL_SHORTCUTS } from '../tools/useActiveTool';
import type { Tool } from './useTool';

/** Undo/redo for the shortcuts (story 8): this tab's own history. */
export interface UndoShortcuts {
  undo(): void;
  redo(): void;
}

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Enter on a single selected object with editable text (story 2). */
  onStartEdit?(id: string): void;
  /** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y (story 8). */
  undo?: UndoShortcuts;
  /** Closes the current undo step; called around each delete and nudge (story 8). */
  boundary?(): void;
  /** The active tool and how to change it (story 9: V, T and Escape). */
  tool?: Tool;
  setTool?(t: Tool): void;
  /** N: a sticky note in the centre of the view (story 9 shortcut for the Sticky note button). */
  onCreateSticky?(): void;
  /** I: the Image tool's file picker (story 12). */
  onOpenImagePicker?(): void;
}


/** Unit direction per arrow key. */
const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** Keys typed into these elements belong to them (text editing, form fields). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Buttons keep Enter/Delete/arrows for themselves (e.g. Enter on a focused swatch). */
function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button');
}

/**
 * Board keyboard commands (sel.keyboard) on window keydown: Ctrl/Cmd+A select all, Escape
 * clear, arrows nudge (Shift: larger step), Delete/Backspace delete the selection, Enter edit a
 * single selected sticky. Ignored while text is being edited or focus is in a form field; the
 * mutating keys do nothing when the board cannot be edited. Handled keys are preventDefault-ed
 * (no page text selection, no page scroll, no board pan). Story 8: Ctrl/Cmd+Z undoes and
 * Ctrl/Cmd+Shift+Z / Ctrl+Y redo this person's own steps (not while the board is read-only).
 * Story 9 tool shortcuts: V Select, T Text (only while editable), N new sticky note at the view
 * centre, Escape with a tool other than Select back to Select (without clearing the selection).
 * Story 10 adds S Shape and L Connector, story 11 P Pen, story 12 I Image (file picker; only
 * while editable).
 */
export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      const {
        doc,
        selection,
        snapshot,
        canEdit,
        onStartEdit,
        undo,
        boundary,
        tool,
        setTool,
        onCreateSticky,
        onOpenImagePicker,
      } = optsRef.current;
      // While a note is edited its editor handles undo itself (typing steps in that note).
      if (selection.editingId !== null || isEditableTarget(e.target)) return;
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      const history = undoKey(e);
      if (history !== null) {
        if (!canEdit || !undo) return;
        e.preventDefault();
        if (history === 'undo') undo.undo();
        else undo.redo();
        return;
      }

      if (ctrlOrMeta && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot, isRegisteredType), false);
        return;
      }
      if (ctrlOrMeta) return;

      if (e.key === 'Escape') {
        if (tool !== undefined && tool !== 'select' && setTool) {
          setTool('select');
          return;
        }
        if (selection.ids.size > 0) selection.clear();
        return;
      }
      const letter = e.key.length === 1 ? e.key.toLowerCase() : '';
      if (letter === 'v' && setTool) {
        setTool('select');
        return;
      }
      // Creation tools (T text, S shape, L connector): only while the board can be edited.
      const shortcut = TOOL_SHORTCUTS[letter];
      if (shortcut !== undefined && shortcut !== 'select' && MODE_TOOLS.has(shortcut) && setTool) {
        if (canEdit && !e.repeat) setTool(shortcut);
        return;
      }
      if (letter === 'i' && onOpenImagePicker) {
        if (canEdit && !e.repeat) {
          e.preventDefault();
          setTool?.('select');
          onOpenImagePicker();
        }
        return;
      }
      if (letter === 'n' && onCreateSticky) {
        if (canEdit && !e.repeat) onCreateSticky();
        return;
      }
      if (isButtonTarget(e.target)) return;
      const ids = [...selection.ids];
      if (ids.length === 0) return;

      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault();
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, Point>();
        for (const obj of snapshot) {
          if (selection.ids.has(obj.id)) positions.set(obj.id, { x: obj.x + arrow.x * step, y: obj.y + arrow.y * step });
        }
        boundary?.();
        moveObjects(doc, positions);
        boundary?.();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (!canEdit) return;
        boundary?.();
        deleteObjects(doc, ids);
        boundary?.();
        selection.clear();
        return;
      }
      if (e.key === 'Enter' && ids.length === 1 && !e.shiftKey) {
        const obj = snapshot.find((o) => o.id === ids[0]);
        if (!obj || !getObjectType(obj.type)?.editableText) return;
        e.preventDefault();
        if (canEdit) onStartEdit?.(obj.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
