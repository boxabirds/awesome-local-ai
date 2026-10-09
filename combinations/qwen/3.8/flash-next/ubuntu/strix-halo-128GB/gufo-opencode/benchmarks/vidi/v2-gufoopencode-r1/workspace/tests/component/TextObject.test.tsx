import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useMemo, useRef, useState, type JSX, type MutableRefObject } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { createUndo } from '../../src/client/board/undo';
import { UndoContext } from '../../src/client/board/useUndo';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import {
  createSticky,
  deleteObjects,
  initDoc,
  snapshotAll,
  LOCAL_ORIGIN,
  type ObjectSnapshot
} from '../../src/shared/board-model';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { TEXT_SIZES } from '../../src/shared/config';

interface Ctl {
  doc: Y.Doc;
  selection: SelectionApi;
}

let registry: MutableRefObject<Ctl | null> = { current: null };

function Harness(): JSX.Element {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;
  const [notes, setNotes] = useState<readonly ObjectSnapshot[]>(() => snapshotAll(doc));
  useEffect(() => {
    const objects = doc.getMap('objects');
    const observer = (): void => setNotes(snapshotAll(doc));
    objects.observeDeep(observer);
    return () => objects.unobserveDeep(observer);
  }, [doc]);
  const selection = useSelection(notes);
  const undo = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);
  registry.current = { doc, selection };
  return (
    <UndoContext.Provider value={undo}>
      <BoardViewport doc={doc} notes={notes} selection={selection} editable />
    </UndoContext.Provider>
  );
}

function ctl(): Ctl {
  return registry.current!;
}

function entry(id: string): Y.Map<unknown> {
  return ctl().doc.getMap('objects').get(id) as Y.Map<unknown>;
}

function typeText(id: string, value: string): void {
  const ytext = getTextContent(ctl().doc, id)!;
  act(() => {
    ytext.doc!.transact(() => ytext.insert(0, value), LOCAL_ORIGIN);
  });
}

function click(id: string): void {
  act(() => {
    ctl().selection.click(id);
  });
}

beforeEach(() => {
  registry = { current: null };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('text.render', () => {
  test('TC-19 renders text at its position with the size font', () => {
    render(<Harness />);
    let id = '';
    act(() => {
      id = createText(ctl().doc, { x: 40, y: -60 }, 'session') as string;
    });
    typeText(id, 'hello world');
    const el = screen.getByTestId(`text-${id}`);
    expect(el.style.left).toBe('40px');
    expect(el.style.top).toBe('-60px');
    expect(screen.getByTestId(`text-content-${id}`).textContent).toBe('hello world');
    expect(el.style.fontSize).toBe(`${TEXT_SIZES.M}px`);
    // The auto box grew to hold the text.
    expect(entry(id).get('width')).toBeGreaterThan(40);
  });

  test('TC-20 ending editing with empty text deletes the object', () => {
    render(<Harness />);
    let id = '';
    act(() => {
      id = createText(ctl().doc, { x: 0, y: 0 }, 'session') as string;
    });
    act(() => {
      ctl().selection.startEdit(id);
    });
    expect(screen.queryByTestId(`text-editor-${id}`)).not.toBeNull();
    act(() => {
      ctl().selection.endEdit('selected');
    });
    expect(ctl().doc.getMap('objects').has(id)).toBe(false);
    expect(screen.queryByTestId(`text-${id}`)).toBeNull();
    expect(ctl().selection.editingId).toBeNull();
    expect(ctl().selection.ids.has(id)).toBe(false);
  });

  test('TC-21 whitespace-only text is kept', () => {
    render(<Harness />);
    let id = '';
    act(() => {
      id = createText(ctl().doc, { x: 0, y: 0 }, 'session') as string;
      ctl().selection.startEdit(id);
    });
    const editor = screen.getByTestId(`text-editor-${id}`);
    fireEvent.input(editor, { target: { value: '   ' } });
    act(() => {
      ctl().selection.endEdit('selected');
    });
    expect(ctl().doc.getMap('objects').has(id)).toBe(true);
    expect(getTextContent(ctl().doc, id)!.toString()).toBe('   ');
  });

  test('TC-22 a text-only selection shows e/w handles only; mixing in a sticky shows all', () => {
    render(<Harness />);
    let textId = '';
    let stickyId = '';
    act(() => {
      textId = createText(ctl().doc, { x: 0, y: 0 }, 'session') as string;
      stickyId = createSticky(ctl().doc, { x: 300, y: 0 }) as string;
    });
    click(textId);
    expect(screen.queryByTestId('resize-handle-e')).not.toBeNull();
    expect(screen.queryByTestId('resize-handle-w')).not.toBeNull();
    expect(screen.queryByTestId('resize-handle-n')).toBeNull();
    expect(screen.queryByTestId('resize-handle-se')).toBeNull();
    act(() => {
      ctl().selection.setMany([textId, stickyId], false);
    });
    expect(screen.queryByTestId('resize-handle-n')).not.toBeNull();
  });

  test('TC-23 dragging the e handle fixes the width and remeasures the height', () => {
    vi.useFakeTimers();
    render(<Harness />);
    let id = '';
    act(() => {
      id = createText(ctl().doc, { x: 0, y: 0 }, 'session') as string;
    });
    typeText(id, 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj');
    const widthBefore = entry(id).get('width') as number;
    const heightBefore = entry(id).get('height') as number;
    expect(entry(id).get('widthMode')).toBe('auto');
    click(id);
    const handle = screen.getByTestId('resize-handle-e');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 600, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 470, clientY: 300 });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    fireEvent.pointerUp(window, { pointerId: 7 });
    const after = entry(id);
    expect(after.get('widthMode')).toBe('fixed');
    expect(after.get('width') as number).toBeLessThan(widthBefore);
    expect(after.get('height') as number).toBeGreaterThan(heightBefore);
    // Height stays content-derived on the next remeasure (no stretching).
    expect(after.get('height') as number).toBeLessThan(heightBefore * 6);
  });

  test('TC-24 remote delete while editing drops the editor without recreating the object', () => {
    render(<Harness />);
    let id = '';
    act(() => {
      id = createText(ctl().doc, { x: 0, y: 0 }, 'session') as string;
      ctl().selection.startEdit(id);
    });
    const editor = screen.getByTestId(`text-editor-${id}`);
    act(() => {
      ctl().doc.transact(() => deleteObjects(ctl().doc, [id]), null);
    });
    expect(screen.queryByTestId(`text-editor-${id}`)).toBeNull();
    expect(screen.queryByTestId(`text-${id}`)).toBeNull();
    expect(ctl().selection.editingId).toBeNull();
    expect(ctl().doc.getMap('objects').has(id)).toBe(false);
    // Typing afterwards (the editor is gone) must not resurrect the object.
    expect(editor.isConnected).toBe(false);
    fireEvent.input(editor, { target: { value: 'ghost' } });
    expect(ctl().doc.getMap('objects').has(id)).toBe(false);
  });

  test('TC-25 the toolbar changes the size, remeasures, and the change lives in the doc', () => {
    render(<Harness />);
    let id = '';
    act(() => {
      id = createText(ctl().doc, { x: 0, y: 0 }, 'session') as string;
    });
    typeText(id, 'hello');
    const hBefore = entry(id).get('height') as number;
    click(id);
    expect(screen.getByRole('button', { name: 'Text size M' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Text size XL' }));
    expect(entry(id).get('size')).toBe('XL');
    const hAfter = entry(id).get('height') as number;
    expect(hAfter).toBeGreaterThan(hBefore);
    expect(screen.getByTestId(`text-${id}`).style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
  });

  test('mixed group resize scales stickies; text keeps size and only its centre moves', () => {
    vi.useFakeTimers();
    render(<Harness />);
    let textId = '';
    let stickyId = '';
    act(() => {
      textId = createText(ctl().doc, { x: 400, y: 0 }, 'session') as string;
      stickyId = createSticky(ctl().doc, { x: -300, y: 0 }) as string;
    });
    typeText(textId, 'keep me');
    const textW = entry(textId).get('width') as number;
    const textH = entry(textId).get('height') as number;
    act(() => {
      ctl().selection.setMany([textId, stickyId], false);
    });
    const handle = screen.getByTestId('resize-handle-e');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 9, clientX: 600, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 800, clientY: 300 });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    fireEvent.pointerUp(window, { pointerId: 9 });
    const sticky = entry(stickyId);
    expect((sticky.get('width') as number)).toBeGreaterThan(200);
    const text = entry(textId);
    expect(text.get('width')).toBe(textW);
    expect(text.get('height')).toBe(textH);
    expect(text.get('widthMode')).toBe('auto');
    // The text sat right of the union centre, so scaling out moves it right.
    expect(text.get('x') as number).toBeGreaterThan(400);
  });

  test('text typed in one editing session is a single undo step', () => {
    render(<Harness />);
    let id = '';
    act(() => {
      id = createText(ctl().doc, { x: 0, y: 0 }, 'session') as string;
      ctl().selection.startEdit(id);
    });
    const editor = screen.getByTestId(`text-editor-${id}`);
    fireEvent.input(editor, { target: { value: 'hello world' } });
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(getTextContent(ctl().doc, id)!.toString()).toBe('');
    expect(ctl().doc.getMap('objects').has(id)).toBe(true);
    act(() => {
      ctl().selection.endEdit('selected');
    });
    expect(ctl().doc.getMap('objects').has(id)).toBe(false);
  });
});
