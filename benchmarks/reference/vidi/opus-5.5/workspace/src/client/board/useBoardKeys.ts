import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType, isRegisteredType } from '../objects/registry';
import type { Selection } from './useSelection';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Enter on a single selected object with editable text (story 2). */
  onStartEdit?(id: string): void;
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
 * (no page text selection, no page scroll, no board pan).
 */
export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      const { doc, selection, snapshot, canEdit, onStartEdit } = optsRef.current;
      if (selection.editingId !== null || isEditableTarget(e.target)) return;
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      if (ctrlOrMeta && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot, isRegisteredType), false);
        return;
      }
      if (ctrlOrMeta) return;

      if (e.key === 'Escape') {
        if (selection.ids.size > 0) selection.clear();
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
        moveObjects(doc, positions);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (!canEdit) return;
        deleteObjects(doc, ids);
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
