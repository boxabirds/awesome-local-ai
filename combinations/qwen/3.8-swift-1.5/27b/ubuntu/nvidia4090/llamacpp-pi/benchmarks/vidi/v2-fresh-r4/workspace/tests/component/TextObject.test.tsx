import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { render, fireEvent } from '@testing-library/react';
import { initDoc, snapshot, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, setTextSize, setTextWidthFixed } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { TextObject } from '../../src/client/objects/TextObject';
import { TextToolbar } from '../../src/client/objects/TextToolbar';
import { TEXT_MAX_CHARS } from '../../src/shared/config';
import type { TextSnapshot } from '../../src/shared/board-model';
import type { TextObjectProps } from '../../src/client/objects/TextObject';

function makeDoc(content = ''): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createText(doc, { x: 10, y: 20 }, 'g_test')!;
  if (content) {
    const ytext = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
    applyTextDiff(ytext, content, LOCAL_ORIGIN);
  }
  return { doc, id };
}

function renderObject(doc: Y.Doc, id: string, overrides: Partial<TextObjectProps> = {}) {
  const obj = snapshot(doc).find((s) => s.id === id)!;
  const props: TextObjectProps = {
    obj,
    selected: false,
    editing: false,
    onPointerDown: vi.fn(),
    onDoubleClick: vi.fn(),
    doc,
    onEndEdit: vi.fn(),
    onBoundary: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...overrides,
  };
  return render(<TextObject {...props} />);
}

describe('TextObject component (story 9)', () => {
  // TC-14
  it('TC-14: renders a .text-object at (x, y) with the stored box (auto and fixed width)', () => {
    const { doc, id } = makeDoc('Went well');
    const { container } = renderObject(doc, id);
    const el = container.querySelector('.text-object') as HTMLDivElement;
    expect(el).not.toBeNull();
    expect(el.dataset.vidi6).toBe('text');
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
    // Stored box height (M × line height)
    expect(el.style.height).toBe('26px');
    // The rendered box is always the stored box: in auto mode the stored
    // width is the measured content width
    const stored = snapshot(doc).find((s) => s.id === id)!;
    expect(el.style.width).toBe(`${stored.width}px`);
  });

  it('TC-14b: fixed mode applies the stored width inline', () => {
    const { doc, id } = makeDoc('Went well');
    setTextWidthFixed(doc, id, 120);
    const { container } = renderObject(doc, id);
    const el = container.querySelector('.text-object') as HTMLDivElement;
    expect(el.style.width).toBe('120px');
  });

  // TC-15
  it('TC-15: content renders in a pre-wrap span (newlines preserved)', () => {
    const { doc, id } = makeDoc('line one\nline two');
    const { container } = renderObject(doc, id);
    const span = container.querySelector('.text-content') as HTMLSpanElement;
    expect(span).not.toBeNull();
    expect(span.style.whiteSpace).toBe('pre-wrap');
    expect(span.textContent).toBe('line one\nline two');
  });

  // TC-16
  it('TC-16: while editing, a size-classed textarea is rendered', () => {
    const { doc, id } = makeDoc('Went well');
    setTextSize(doc, id, 'XL');
    const { container } = renderObject(doc, id, { editing: true });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta.value).toBe('Went well');
    expect(ta.className).toContain('text-size-XL');
  });

  // TC-17
  it('TC-17: after endEditing the textarea is replaced by the span', () => {
    const { doc, id } = makeDoc('Went well');
    const first = renderObject(doc, id, { editing: true });
    expect(first.container.querySelector('textarea')).not.toBeNull();
    expect(first.container.querySelector('.text-content')).toBeNull();
    first.unmount();

    const second = renderObject(doc, id, { editing: false });
    expect(second.container.querySelector('textarea')).toBeNull();
    expect(second.container.querySelector('.text-content')!.textContent).toBe('Went well');
  });

  // TC-18
  it('TC-18: input is clamped to TEXT_MAX_CHARS in the doc', () => {
    const { doc, id } = makeDoc('');
    const { container } = renderObject(doc, id, { editing: true });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    const long = 'a'.repeat(TEXT_MAX_CHARS + 1);
    fireEvent.change(ta, { target: { value: long } });
    const ytext = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
    expect(ytext.length).toBe(TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe('a'.repeat(TEXT_MAX_CHARS));
  });

  // TC-19
  it('TC-19: Delete on empty text deletes the object and ends editing', () => {
    const { doc, id } = makeDoc('');
    const onEndEdit = vi.fn();
    const { container } = renderObject(doc, id, { editing: true, onEndEdit });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'Delete' });
    expect(doc.getMap('objects').has(id)).toBe(false);
    expect(onEndEdit).toHaveBeenCalledTimes(1);
  });

  // TC-20
  it('TC-20: Delete on non-empty text keeps the object', () => {
    const { doc, id } = makeDoc('hello');
    const onEndEdit = vi.fn();
    const { container } = renderObject(doc, id, { editing: true, onEndEdit });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'Delete' });
    expect(doc.getMap('objects').has(id)).toBe(true);
    expect(onEndEdit).not.toHaveBeenCalled();
  });
});

describe('TextToolbar (story 9)', () => {
  function renderToolbar(doc: Y.Doc, id: string, overrides: Record<string, unknown> = {}) {
    const snap = snapshot(doc).find((s) => s.id === id) as TextSnapshot;
    const props = {
      snap,
      doc,
      onSize: vi.fn(),
      onDelete: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      ...overrides,
    };
    return render(<TextToolbar {...props} />);
  }

  // TC-21
  it('TC-21: undo and redo buttons call their handlers', () => {
    const { doc, id } = makeDoc('hello');
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { container } = renderToolbar(doc, id, { onUndo, onRedo });
    fireEvent.click(container.querySelector('[data-vidi6="text-undo"]')!);
    fireEvent.click(container.querySelector('[data-vidi6="text-redo"]')!);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  // TC-22
  it('TC-22: size buttons S M L XL set the size on the doc', () => {
    const { doc, id } = makeDoc('hello');
    const { container } = renderToolbar(doc, id);
    const buttons = container.querySelectorAll('[data-vidi6^="text-size-"]');
    expect(buttons.length).toBe(4);
    fireEvent.click(container.querySelector('[data-vidi6="text-size-L"]')!);
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(obj.get('size')).toBe('L');
    // Active state moves to L
    expect((container.querySelector('[data-vidi6="text-size-L"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
  });

  it('delete button deletes the text object', () => {
    const { doc, id } = makeDoc('hello');
    const onDelete = vi.fn();
    const { container } = renderToolbar(doc, id, { onDelete });
    fireEvent.click(container.querySelector('[data-vidi6="text-delete"]')!);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
