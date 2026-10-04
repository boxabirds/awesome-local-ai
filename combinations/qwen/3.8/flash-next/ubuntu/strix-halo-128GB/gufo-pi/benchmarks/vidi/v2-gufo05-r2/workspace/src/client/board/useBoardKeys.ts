import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';

import {
  moveObjects,
  objectBounds,
  objectSnapshots,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';

export interface BoardKeyOptions {
  doc: Y.Doc;
  /** False while the board may not be changed (story 4's `canEdit`). */
  editable: boolean;
  objects: readonly ObjectSnapshot[];
  /** The registry decides what counts as an object this page can act on. */
  isSelectable(type: string): boolean;
  selectedIds: ReadonlySet<string>;
  editingId: string | null;
  selectAll(): void;
  clear(): void;
  startEdit(id: string): void;
  /** Remove every selected object, then forget the selection. */
  deleteSelection(): void;
  /** Story 8: reverse this person's last change (Ctrl/Cmd+Z). */
  undo(): void;
  /** Story 8: re-apply the last undone change (Ctrl/Cmd+Shift+Z, Ctrl+Y). */
  redo(): void;
  /** Story 8: close the undo capture window so a nudge is its own step. */
  boundary?(): void;
}

/**
 * The keyboard commands, for every object type at once.
 *
 * They are attached to `window` and skipped while someone is typing, so the keys
 * mean the same thing wherever the focus happens to be: arrows nudge the whole
 * selection (shift for a larger step), delete removes it, escape drops it,
 * ctrl/cmd-A selects every object on the board, and Enter opens the text of the
 * one object that has any.
 */
export function useBoardKeys(options: BoardKeyOptions): void {
  const current = useRef(options);
  current.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const opts = current.current;
      // While typing in an object, or any field, the keys edit text.
      if (opts.editingId !== null || isEditableTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;

      if (mod && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault();
        opts.selectAll();
        return;
      }
      if (event.key === 'Escape') {
        opts.clear();
        blurFocus();
        return;
      }
      // Undo and redo act on the history, not the selection, so they are handled
      // before the empty-selection guard — an empty board still undoes. They are
      // only ever this person's own steps (the controller tracks LOCAL_ORIGIN).
      if (mod && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        if (!opts.editable) return;
        if (event.shiftKey) opts.redo();
        else opts.undo();
        return;
      }
      if (mod && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault();
        if (opts.editable) opts.redo();
        return;
      }
      if (opts.selectedIds.size === 0) return;

      const step = arrowStep(event);
      if (step) {
        event.preventDefault();
        if (!opts.editable) return;
        opts.boundary?.();
        nudge(opts.doc, [...opts.selectedIds], step);
        opts.boundary?.();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (!opts.editable) return;
        opts.deleteSelection();
        return;
      }
      if (event.key === 'Enter') {
        if (!opts.editable || opts.selectedIds.size !== 1) return;
        const [id] = [...opts.selectedIds];
        const object = opts.objects.find((entry) => entry.id === id);
        if (!object || !getObjectType(object.type)?.editableText) return;
        event.preventDefault();
        opts.startEdit(id!);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/**
 * Nudge a group by a whole board step, in one transaction. The positions are read
 * from the document rather than from the last render, so a key pressed in between
 * still uses the numbers that are there now.
 */
function nudge(doc: Y.Doc, ids: string[], step: Point): void {
  const positions = new Map<string, Point>();
  for (const object of objectSnapshots(doc)) {
    if (!ids.includes(object.id)) continue;
    const box = objectBounds(object);
    positions.set(object.id, { x: Math.round(box.x + step.x), y: Math.round(box.y + step.y) });
  }
  moveObjects(doc, positions);
}

function arrowStep(event: KeyboardEvent): Point | null {
  const units = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
  switch (event.key) {
    case 'ArrowLeft':
      return { x: -units, y: 0 };
    case 'ArrowRight':
      return { x: units, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -units };
    case 'ArrowDown':
      return { x: 0, y: units };
    default:
      return null;
  }
}

function blurFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}
