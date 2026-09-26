import { describe, it, expect, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import {
  createSticky,
  deleteObjects,
  initDoc,
  objectSnapshots,
} from '../../src/shared/board-model';
import {
  createText,
  getTextContent,
  setTextBox,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { fireKey, firePointer } from './helpers';

/**
 * Story 9, text.object (TC-19 to TC-25): rendering, editing, the size
 * toolbar, horizontal-only handles, remote delete and the undo coupling of
 * text and box.
 */

type SizedText = TextSnapshot & { width: number; height: number };

function makeText(
  doc: Y.Doc,
  at = { x: 100, y: 100 },
  content = '',
): string {
  const id = createText(doc, at, 'tester')!;
  if (content.length > 0) {
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => ytext.insert(0, content));
  }
  return id;
}

function renderDoc(setup: (doc: Y.Doc) => void) {
  const doc = new Y.Doc();
  initDoc(doc);
  setup(doc);
  const view = render(<BoardApp doc={doc} />);
  return {
    ...view,
    doc,
    async settle() {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    },
    text(id: string): SizedText | undefined {
      const t = objectSnapshots(doc).find((o) => o.id === id) as TextSnapshot | undefined;
      return t !== undefined && t.width !== undefined && t.height !== undefined
        ? (t as SizedText)
        : undefined;
    },
  };
}

function selectByPointer(id: string) {
  const el = screen.getByTestId(`text-object-${id}`);
  firePointer(el, 'pointerdown', 110, 110);
  firePointer(el, 'pointerup', 110, 110);
}

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    fireEvent.input(textarea, { target: { value } });
  });
}

beforeEach(cleanup);

describe('TC-19: editing behaviour', () => {
  it('caret at end, Enter newline typed through, Escape ends keeping text selected', async () => {
    const { settle, doc } = renderDoc((d) => {
      makeText(d, { x: 100, y: 100 }, 'hello');
    });
    await settle();
    const firstId = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    selectByPointer(firstId);
    await settle();
    act(() => {
      fireEvent.doubleClick(screen.getByTestId(`text-object-${firstId}`));
    });
    await settle();
    const textarea = screen.getByTestId(`text-textarea-${firstId}`) as HTMLTextAreaElement;
    expect(textarea.value).toBe('hello');
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);

    // Enter inserts a newline (native editing behaviour; through the editor's
    // flush path it must survive into the Y.Text and not end editing).
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter' });
    });
    typeInto(textarea, 'hello world');
    await settle();
    expect(screen.getByTestId(`text-textarea-${firstId}`)).toBeDefined();

    // Escape ends editing, keeps the text and keeps it selected.
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await settle();
    expect(screen.queryByTestId(`text-textarea-${firstId}`)).toBeNull();
    expect(screen.getByTestId(`text-object-${firstId}`).dataset.selected).toBe('true');
    expect((objectSnapshots(doc).find((o) => o.id === firstId)! as TextSnapshot).text).toBe('hello world');
  });

  it('Enter on a single selected text starts editing', async () => {
    const { settle, doc } = renderDoc((d) => {
      makeText(d);
    });
    await settle();
    const id = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    selectByPointer(id);
    await settle();
    fireKey({ key: 'Enter' });
    await settle();
    expect(screen.getByTestId(`text-textarea-${id}`)).toBeDefined();
  });
});

describe('TC-20: empty text removes the object', () => {
  it('Escape with zero characters deletes it and clears selection', async () => {
    const { settle, doc } = renderDoc(() => {});
    await settle();
    fireKey({ key: 't' });
    await settle();
    const layer = screen.getByTestId('text-tool-layer');
    firePointer(layer, 'pointerdown', 200, 200);
    firePointer(layer, 'pointerup', 200, 200);
    await settle();
    const id = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    const textarea = screen.getByTestId(`text-textarea-${id}`) as HTMLTextAreaElement;
    expect(textarea).toBeDefined();

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await settle();
    // Gone entirely — no invisible text object left behind.
    expect(objectSnapshots(doc).filter((o) => o.type === 'text').length).toBe(0);
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
    expect(screen.queryByTestId('text-toolbar')).toBeNull();
  });

  it('blank characters count as content', async () => {
    const { settle, doc } = renderDoc((d) => {
      makeText(d);
    });
    await settle();
    const id = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    selectByPointer(id);
    await settle();
    act(() => {
      fireEvent.doubleClick(screen.getByTestId(`text-object-${id}`));
    });
    await settle();
    const textarea = screen.getByTestId(`text-textarea-${id}`) as HTMLTextAreaElement;
    typeInto(textarea, ' ');
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await settle();
    expect(objectSnapshots(doc).filter((o) => o.type === 'text').length).toBe(1);
  });
});

describe('TC-21: TextToolbar sizes', () => {
  it('S/M/L/XL with M pressed; XL keeps x/y and changes the size', async () => {
    const { settle, doc, text } = renderDoc((d) => {
      makeText(d, { x: 120, y: 340 }, 'sample');
    });
    await settle();
    const id = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    selectByPointer(id);
    await settle();

    const toolbar = screen.getByTestId('text-toolbar');
    expect(toolbar).toBeDefined();
    for (const size of ['S', 'M', 'L', 'XL'] as const) {
      expect(screen.getByTestId(`text-size-${size}`)).toBeDefined();
    }
    expect(screen.getByTestId('text-size-M').getAttribute('aria-pressed')).toBe('true');

    const before = text(id)!;
    act(() => {
      fireEvent.click(screen.getByTestId('text-size-XL'));
    });
    await settle();
    const after = text(id)!;
    expect(after.size).toBe('XL');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.height).toBeGreaterThan(before.height);
    expect(screen.getByTestId('text-size-XL').getAttribute('aria-pressed')).toBe('true');
  });

  it('delete button removes the text object', async () => {
    const { settle, doc } = renderDoc((d) => {
      makeText(d, { x: 0, y: 0 }, 'bye');
    });
    await settle();
    const id = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    selectByPointer(id);
    await settle();
    act(() => {
      fireEvent.click(screen.getByTestId('delete-text'));
    });
    await settle();
    expect(objectSnapshots(doc).length).toBe(0);
  });
});

describe('TC-22: horizontal-only handles', () => {
  it('a single selected text shows only the e and w handles', async () => {
    const { settle, doc } = renderDoc((d) => {
      makeText(d, { x: 50, y: 50 }, 'wide enough text to drag');
    });
    await settle();
    const id = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    selectByPointer(id);
    await settle();
    const handles = Array.from(
      document.querySelectorAll('[data-testid^="resize-handle-"]'),
    ).map((el) => el.getAttribute('data-handle'));
    expect(handles.sort()).toEqual(['e', 'w']);
  });

  it('dragging e switches to fixed width and rewraps the height', async () => {
    const { settle, doc, text } = renderDoc((d) => {
      const id = makeText(d, { x: 100, y: 100 }, 'hello hello hello hello');
      // A measured single-line box at width 300 (text estimates ~247 wide).
      setTextBox(d, id, { width: 300, height: 26 });
    });
    await settle();
    const id = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    selectByPointer(id);
    await settle();
    const before = text(id)!;
    expect(before.widthMode).toBe('auto');
    expect(before.width).toBe(300);

    const handle = screen.getByTestId('resize-handle-e');
    firePointer(handle, 'pointerdown', 0, 0);
    const viewport = screen.getByTestId('board-viewport');
    // Drag left: narrower fixed width, more lines, taller box.
    firePointer(viewport, 'pointermove', -80, 0);
    firePointer(viewport, 'pointerup', -80, 0);
    await settle();

    const after = text(id)!;
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(before.width - 80, 0);
    expect(after.height).toBeGreaterThan(before.height);
  });

  it('a mixed text + sticky selection shows all eight handles', async () => {
    const { settle, doc } = renderDoc((d) => {
      makeText(d, { x: 100, y: 100 }, 'mixed');
      createSticky(d, { x: 500, y: 100 });
    });
    await settle();
    const textId = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    const sticky = screen.getByTestId(/^sticky-note-/);
    selectByPointer(textId);
    await settle();
    firePointer(sticky, 'pointerdown', 520, 110, { shiftKey: true });
    await settle();
    const handles = Array.from(
      document.querySelectorAll('[data-testid^="resize-handle-"]'),
    ).map((el) => el.getAttribute('data-handle'));
    expect(handles.length).toBe(8);
  });
});

describe('TC-23: mixed resize repositions text proportionally', () => {
  it('resizing text + sticky scales positions, font size unchanged', async () => {
    const { settle, doc, text } = renderDoc((d) => {
      makeText(d, { x: 150, y: 150 }, 'keep me');
      createSticky(d, { x: -300, y: 100 });
    });
    await settle();
    const textId = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    const sticky = screen.getByTestId(/^sticky-note-/);
    selectByPointer(textId);
    await settle();
    firePointer(sticky, 'pointerdown', -280, 110, { shiftKey: true });
    await settle();

    const before = text(textId)!;
    const handle = screen.getByTestId('resize-handle-se');
    firePointer(handle, 'pointerdown', 0, 0);
    const viewport = screen.getByTestId('board-viewport');
    firePointer(viewport, 'pointermove', 200, 100);
    firePointer(viewport, 'pointerup', 200, 100);
    await settle();

    const after = text(textId)!;
    // The text moved away from the anchor proportionally.
    expect(after.x).toBeGreaterThan(before.x);
    // Font size is never a resize casualty.
    expect(after.size).toBe(before.size);
  });
});

describe('TC-24: remote delete while editing', () => {
  it('the editor unmounts without error and the object is not recreated', async () => {
    const { settle, doc } = renderDoc((d) => {
      makeText(d, { x: 0, y: 0 }, 'doomed');
    });
    await settle();
    const id = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    act(() => {
      fireEvent.doubleClick(screen.getByTestId(`text-object-${id}`));
    });
    await settle();
    expect(screen.getByTestId(`text-textarea-${id}`)).toBeDefined();

    // Another peer deletes it.
    act(() => {
      deleteObjects(doc, [id]);
    });
    await settle();
    expect(screen.queryByTestId(`text-textarea-${id}`)).toBeNull();
    expect(screen.queryByTestId(`text-object-${id}`)).toBeNull();
    expect(objectSnapshots(doc).length).toBe(0);
  });
});

describe('TC-25: undo couples text and box', () => {
  it('typing then Ctrl+Z reverts text and stored box in one step', async () => {
    const { settle, doc, text } = renderDoc((d) => {
      makeText(d, { x: 0, y: 0 });
    });
    await settle();
    const id = objectSnapshots(doc).find((o) => o.type === 'text')!.id;
    const before = text(id)!;
    act(() => {
      fireEvent.doubleClick(screen.getByTestId(`text-object-${id}`));
    });
    await settle();
    const textarea = screen.getByTestId(`text-textarea-${id}`) as HTMLTextAreaElement;
    typeInto(textarea, 'hello world');
    await settle();
    const mid = text(id)!;
    expect(mid.text).toBe('hello world');
    expect(mid.width).toBeGreaterThan(before.width);

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    await settle();
    const after = text(id)!;
    expect(after).toBeDefined();
    expect(after.text).toBe('');
    expect(after.width).toBeCloseTo(before.width, 5);
    expect(after.height).toBeCloseTo(before.height, 5);
  });
});
