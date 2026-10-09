/**
 * Story 9 — component tests for text objects (TC-19..TC-25):
 *
 *   - TC-19: entering edit mounts an editor with the caret at the end;
 *            typing writes to the Y.Text.
 *   - TC-20: Escape with zero characters removes the object entirely.
 *   - TC-21: a single text selection shows only the e/w handles; dragging one
 *            changes the width and sets widthMode to fixed.
 *   - TC-22: undo reverts text and box together (one session, same capture
 *            window); an undone-to-empty session removes the object.
 *   - TC-23: the TextToolbar shows the current size pressed; S/M/L/XL write
 *            the size; Delete removes the object.
 *   - TC-24: remote typing is merged into the editor without losing the
 *            caret; local and remote changes converge.
 *   - TC-25: a size change re-measures the stored box for the new font size.
 *
 * Camera pinned to (0,0,1) so world units equal screen pixels.
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { TEXT_SIZES, type TextSize } from '../../src/shared/config';
import { createCanvasMeasurer, layoutText } from '../../src/client/objects/textLayout';
import { renderBoard } from './board-harness';

// Quiet provider (same pattern as the other board component tests).
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
    onState('connected');
    return { destroy() {} };
  },
}));

const REMOTE = 'tc-text-remote';

let h: ReturnType<typeof renderBoard>;

beforeEach(() => {
  h = renderBoard();
  h.setCamera(0, 0, 1);
});

afterEach(() => {
  cleanup();
});

const selectBtn = () => screen.getByRole('button', { name: 'Select (V)' });
const textBtn = () => screen.getByRole('button', { name: 'Text (T)' });

const SEED_MEASURE = createCanvasMeasurer();

function seededText(
  content = 'hello',
  opts: { x?: number; y?: number; size?: string } = {},
): string {
  let id = '';
  h.seed((doc) => {
    id = createText(doc, { x: opts.x ?? 30, y: opts.y ?? 10 }, 'local-user')!;
    const item = doc.getMap('objects').get(id) as Y.Map<any>;
    const size = (opts.size ?? 'M') as TextSize;
    item.set('size', size);
    if (content !== '') {
      const ytext = item.get('text') as Y.Text;
      // Seed the stored box the way the client would have written it.
      const m = layoutText(content, size, 'auto', null, SEED_MEASURE);
      item.set('width', m.width);
      item.set('height', m.height);
      doc.transact(() => {
        ytext.insert(0, content);
      }, 'seed');
    }
  });
  return id;
}

function box(doc: Y.Doc, id: string): { width: number; height: number; widthMode: string; size: string } {
  const i = doc.getMap('objects').get(id) as Y.Map<any>;
  return {
    width: i.get('width') as number,
    height: i.get('height') as number,
    widthMode: i.get('widthMode') as string,
    size: i.get('size') as string,
  };
}

function textCount(doc: Y.Doc): number {
  let n = 0;
  doc.getMap('objects').forEach((v: unknown, _k: string) => {
    const m = v as { get(k: string): unknown } | undefined;
    if (m && m.get('type') === 'text') n += 1;
  });
  return n;
}

function typeInEditor(el: HTMLTextAreaElement, text: string): void {
  // jsdom: setting .value does not fire input; dispatch it afterwards.
  el.value = text;
  fireEvent.input(el);
}

/** Select tool + click the given object (single-selection). */
function selectObject(id: string): void {
  fireEvent.click(selectBtn());
  const obj = h.container.querySelector(`[data-object-id="${id}"]`) as Element;
  fireEvent.pointerDown(obj, { pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });
}

describe('story 9: text object component (TC-19..TC-25)', () => {
  it('TC-19: entering edit mounts the editor, caret at end, typing writes', () => {
    const id = seededText('hello');
    selectObject(id);

    // Enter the edit mode for the selected text.
    const obj = h.container.querySelector(`[data-object-id="${id}"]`) as Element;
    fireEvent.keyDown(obj, { key: 'Enter' });

    const editor = screen.getByLabelText('Text') as HTMLTextAreaElement;
    expect(editor).toBeTruthy();
    // Caret at the end of 'hello' (5).
    expect(editor.selectionEnd).toBe(5);

    // Typing appends and lands in the Y.Text.
    typeInEditor(editor, 'hello!');
    expect(getTextContent(h.doc, id)!.toString()).toBe('hello!');
    expect(editor.value).toBe('hello!');
  });

  it('TC-20: Escape with zero characters removes the object entirely', () => {
    expect(textCount(h.doc)).toBe(0);

    // Arm the text tool and click: a text object is created and edited.
    fireEvent.click(textBtn());
    const layer = h.container.querySelector('[data-text-tool-layer]') as HTMLElement;
    fireEvent.click(layer, { clientX: 300, clientY: 200 });

    expect(textCount(h.doc)).toBe(1);
    const editor = screen.getByLabelText('Text');

    // Escape with zero characters → the object is removed…
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(textCount(h.doc)).toBe(0);
    // …and the editor (and selection) are gone.
    expect(screen.queryByLabelText('Text')).toBeNull();
  });

  it('TC-21: single text selection shows only e/w handles; east drag sets width + fixed', () => {
    const id = seededText('hello');
    selectObject(id);

    // Only the east/west ('right'/'left') handles exist for a text object.
    const east = screen.getByLabelText('Resize right');
    const west = screen.getByLabelText('Resize left');
    expect(east).toBeTruthy();
    expect(west).toBeTruthy();
    expect(screen.queryByLabelText('Resize top')).toBeNull();
    expect(screen.queryByLabelText('Resize bottom')).toBeNull();
    expect(screen.queryByLabelText('Resize top-right')).toBeNull();

    // Drag the east handle +50 world px (zoom 1): width grows, mode → fixed.
    const start = box(h.doc, id);
    fireEvent.pointerDown(east, { pointerId: 2, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 150, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    const after = box(h.doc, id);
    expect(after.width).toBe(start.width + 50);
    expect(after.widthMode).toBe('fixed');
    // The height was re-measured at the new width (still one line here).
    expect(after.height).toBe(start.height);
  });

  it('TC-22: undo reverts text and box together; empty session removes the object', () => {
    // Create + enter the editing session.
    fireEvent.click(textBtn());
    const layer = h.container.querySelector('[data-text-tool-layer]') as HTMLElement;
    fireEvent.click(layer, { clientX: 300, clientY: 200 });

    const editor = screen.getByLabelText('Text') as HTMLTextAreaElement;
    const id = (editor.closest('[data-text-id]') as Element).getAttribute('data-text-id')!;
    expect(id.length).toBeGreaterThan(0);

    typeInEditor(editor, 'Hi');
    expect(getTextContent(h.doc, id)!.toString()).toBe('Hi');
    expect(box(h.doc, id).width).toBeGreaterThan(0);

    // Undo the whole session: each Ctrl+Z reverts one captured transaction
    // (text and box writes alternate); keep undoing until the text is empty.
    let presses = 0;
    while (getTextContent(h.doc, id)!.toString() !== '' && presses < 12) {
      fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
      presses += 1;
    }
    expect(presses).toBeGreaterThan(0);
    expect(getTextContent(h.doc, id)!.toString()).toBe('');
    // The box reverted with the text (same session/capture window) — no
    // half-reverted state with empty text and a large stored box.
    expect(box(h.doc, id).width).toBe(0);
    expect(box(h.doc, id).height).toBe(0);

    // Ending the (now empty) session removes the object entirely.
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(h.doc.getMap('objects').get(id)).toBeUndefined();
  });

  it('TC-23: TextToolbar shows the current size pressed; size + delete work', () => {
    const id = seededText('hello');
    selectObject(id);

    const toolbar = h.container.querySelector('[data-text-toolbar-bar]') as HTMLElement;
    expect(toolbar).toBeTruthy();

    // Current size (M) is pressed; the others are not.
    const sizeBtn = (name: string) => within(toolbar).getByRole('button', { name });
    expect(sizeBtn('Size M').getAttribute('aria-pressed')).toBe('true');
    expect(sizeBtn('Size S').getAttribute('aria-pressed')).toBe('false');
    expect(sizeBtn('Size L').getAttribute('aria-pressed')).toBe('false');
    expect(sizeBtn('Size XL').getAttribute('aria-pressed')).toBe('false');

    // Choosing L writes the size.
    fireEvent.click(sizeBtn('Size L'));
    expect(box(h.doc, id).size).toBe('L');

    // Delete removes the object.
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Delete text' }));
    expect(h.doc.getMap('objects').get(id)).toBeUndefined();
  });

  it('TC-24: remote typing merges into the editor without losing the caret', () => {
    const id = seededText('start');
    selectObject(id);

    // Enter the edit mode.
    const obj = h.container.querySelector(`[data-object-id="${id}"]`) as Element;
    fireEvent.keyDown(obj, { key: 'Enter' });
    const editor = screen.getByLabelText('Text') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionEnd).toBe(5);

    // A remote peer types at the beginning.
    const ytext = getTextContent(h.doc, id)!;
    h.seed((doc) => {
      doc.transact(() => {
        ytext.insert(0, 'X');
      }, REMOTE);
    });
    // The remote change is merged into the textarea and the caret is kept
    // (absolute index preserved while the text shifts under it).
    expect(editor.value).toBe('Xstart');
    expect(editor.selectionEnd).toBe(5);

    // Local typing converges on top of the remote change.
    typeInEditor(editor, 'Xstart!');
    expect(ytext.toString()).toBe('Xstart!');
  });

  it('TC-25: choosing a size re-measures the stored box for the new font', () => {
    const id = seededText('hello');
    selectObject(id);

    const before = box(h.doc, id);
    expect(before.size).toBe('M');
    expect(before.width).toBe(50); // 5 chars × 0.5 × 20px (deterministic estimate)

    const toolbar = h.container.querySelector('[data-text-toolbar-bar]') as HTMLElement;
    expect(toolbar).toBeTruthy();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Size XL' }));

    const after = box(h.doc, id);
    expect(after.size).toBe('XL');
    // Re-measured at 56px: 5 × 0.5 × 56 = 140 (deterministic estimate).
    expect(after.width).toBe(140);
    expect(after.height).toBeCloseTo(72.8, 1); // 1 line × 1.3 × 56
    expect(TEXT_SIZES.XL).toBe(56);
  });
});
