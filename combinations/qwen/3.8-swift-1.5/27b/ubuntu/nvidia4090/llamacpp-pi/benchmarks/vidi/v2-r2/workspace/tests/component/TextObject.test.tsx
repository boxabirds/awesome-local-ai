/**
 * Story 9: text object component tests (TC-19 to TC-25).
 *
 * Covers editing (double-click / Escape / click-outside), live box remeasure
 * while typing, horizontal-only resize, and the text toolbar (sizes + delete).
 */
import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  createText,
  getTextContent,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { objectSnapshot } from '../../src/shared/board-model';
import { TEXT_MAX_AUTO_WIDTH_WORLD } from '../../src/shared/config';
import { createPointerEvent } from './helpers';
import { renderApp, flushRaf } from './sticky-helpers';

function createTextAt(doc: Y.Doc, x: number, y: number, text: string): string {
  let id = '';
  act(() => {
    id = createText(doc, { x, y }, 'client-a') ?? '';
  });
  if (text) {
    act(() => {
      getTextContent(doc, id)!.insert(0, text);
    });
  }
  return id;
}

function getTextObj(doc: Y.Doc, id: string): TextSnapshot | undefined {
  return objectSnapshot(doc).find((o) => o.id === id) as TextSnapshot | undefined;
}

/** Select an object (pointer down/up) then start editing it (double-click). */
function selectAndEdit() {
  const el = screen.getByTestId('text-object');
  act(() => {
    el.dispatchEvent(createPointerEvent('pointerdown', { clientX: 340, clientY: 300, pointerId: 1 }));
    el.dispatchEvent(createPointerEvent('pointerup', { clientX: 340, clientY: 300, pointerId: 1 }));
  });
  act(() => {
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
}

function selectOnly() {
  const el = screen.getByTestId('text-object');
  act(() => {
    el.dispatchEvent(createPointerEvent('pointerdown', { clientX: 340, clientY: 300, pointerId: 1 }));
    el.dispatchEvent(createPointerEvent('pointerup', { clientX: 340, clientY: 300, pointerId: 1 }));
  });
}

function typeInEditor(value: string) {
  const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;
  act(() => {
    editor.value = value;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Story 9: text object (ui-component)', () => {
  it('TC-19: double-click text → editor mounted, focused, prefilled, caret at end', () => {
    const { getDoc } = renderApp();
    createTextAt(getDoc(), -300, -100, 'Hello');
    selectAndEdit();

    const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    expect(editor).toHaveFocus();
    expect(editor.value).toBe('Hello');
    expect(editor.selectionStart).toBe(5);
    expect(editor.selectionEnd).toBe(5);
  });

  it('TC-20: typing updates Y.Text, remeasures the box, clamps width at the cap', () => {
    const { getDoc } = renderApp();
    const id = createTextAt(getDoc(), -300, -100, '');
    selectAndEdit();

    typeInEditor('Hello');
    expect(getTextContent(getDoc(), id)!.toString()).toBe('Hello');
    const obj = getTextObj(getDoc(), id)!;
    // Grew from the 40-unit empty estimate to the measured content width.
    expect(obj.width).toBeGreaterThan(40);

    // Long content → width clamped at TEXT_MAX_AUTO_WIDTH_WORLD.
    typeInEditor('w'.repeat(200));
    const obj2 = getTextObj(getDoc(), id)!;
    expect(obj2.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('TC-21: Escape on empty text → object deleted, selection cleared', () => {
    const { getDoc } = renderApp();
    const id = createTextAt(getDoc(), -300, -100, '');
    selectAndEdit();

    const editor = screen.getByTestId('text-editor');
    act(() => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(getTextObj(getDoc(), id)).toBeUndefined();
    expect(screen.queryByTestId('text-object')).toBeNull();
  });

  it('TC-22: Escape on non-empty text → object kept, content preserved, selection kept', () => {
    const { getDoc } = renderApp();
    const id = createTextAt(getDoc(), -300, -100, 'Hello');
    selectAndEdit();

    const editor = screen.getByTestId('text-editor');
    act(() => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    const obj = getTextObj(getDoc(), id)!;
    expect(obj).toBeDefined();
    expect(obj.text).toBe('Hello');
    // Editor unmounted, object still selected.
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(screen.getByTestId('text-object')).toHaveAttribute('data-selected');
  });

  it('TC-23: click outside → editor unmounted, object kept', () => {
    const { getDoc } = renderApp();
    const id = createTextAt(getDoc(), -300, -100, 'Hello');
    selectAndEdit();
    expect(screen.getByTestId('text-editor')).not.toBeNull();

    const vp = screen.getByTestId('board-viewport');
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 3 }));
    });

    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(getTextObj(getDoc(), id)).toBeDefined();
  });

  it('TC-24: e-handle resize → width changes, height unchanged during drag; fixed mode, height remeasured at end', async () => {
    const { getDoc } = renderApp();
    const id = createTextAt(getDoc(), -300, -100, 'Hello world');
    selectOnly();

    const before = getTextObj(getDoc(), id)!;
    // The box starts at the empty estimate (40 × 26), auto mode.
    expect(before.width).toBe(40);
    expect(before.height).toBe(26);
    expect(before.widthMode).toBe('auto');

    // Grab the east handle and drag right (wider).
    const eHandle = screen.getByTestId('resize-handle-e');
    act(() => {
      eHandle.dispatchEvent(createPointerEvent('pointerdown', { clientX: 200, clientY: 300, pointerId: 2 }));
    });
    act(() => {
      window.dispatchEvent(createPointerEvent('pointermove', { clientX: 250, clientY: 300, pointerId: 2 }));
    });
    await flushRaf();

    const during = getTextObj(getDoc(), id)!;
    expect(during.width).toBeGreaterThan(before.width);
    expect(during.height).toBe(before.height); // not remeasured during the drag
    expect(during.widthMode).toBe('fixed');

    // Release → the fixed width is committed and the height remeasured.
    act(() => {
      window.dispatchEvent(createPointerEvent('pointerup', { clientX: 250, clientY: 300, pointerId: 2 }));
    });
    await flushRaf();

    const after = getTextObj(getDoc(), id)!;
    expect(after.width).toBe(during.width);
    expect(after.widthMode).toBe('fixed');
    // “Hello world” wraps to 2 lines at the fixed width → the height grows.
    expect(after.height).toBeGreaterThan(before.height);
  });

  it('TC-25: TextToolbar size buttons change size, remeasure the box, and show the active state', () => {
    const { getDoc } = renderApp();
    const id = createTextAt(getDoc(), -300, -100, 'Hello');
    selectOnly();

    // The text toolbar is shown; M is the default active size.
    expect(screen.getByTestId('text-toolbar')).not.toBeNull();
    expect(screen.getByTestId('text-size-M')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('text-size-S')).toHaveAttribute('aria-pressed', 'false');

    const before = getTextObj(getDoc(), id)!;

    // Switch to S.
    act(() => {
      screen.getByTestId('text-size-S').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    let obj = getTextObj(getDoc(), id)!;
    expect(obj.size).toBe('S');
    expect(screen.getByTestId('text-size-S')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('text-size-M')).toHaveAttribute('aria-pressed', 'false');
    // The box remeasured (a single line's height scales with the size).
    expect(obj.height).not.toBe(before.height);

    // Switch to L.
    act(() => {
      screen.getByTestId('text-size-L').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    obj = getTextObj(getDoc(), id)!;
    expect(obj.size).toBe('L');
    expect(screen.getByTestId('text-size-L')).toHaveAttribute('aria-pressed', 'true');
  });
});
