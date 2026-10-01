// @vitest-environment jsdom
/**
 * Component tests — TextObject (story 9, TC-19..TC-25).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import type { JSX } from 'react';
import { useEffect, useReducer } from 'react';
import { TextObjectComponent } from '../../src/client/objects/TextObject';
import { TextToolbar } from '../../src/client/objects/TextToolbar';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { createUndo } from '../../src/client/board/undo';
import { snapshot, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, setTextSize, type TextSnapshot } from '../../src/shared/objects/text';
import type { Camera } from '../../src/client/canvas/camera';
import type { UseSelectionResult } from '../../src/client/board/useSelection';

vi.useFakeTimers();

const IDENTITY: Camera = { x: 0, y: 0, zoom: 1 };

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  cleanup();
  doc.destroy();
});

function makeText(text: string, at = { x: 100, y: 120 }): string {
  const id = createText(doc, at, 'g_test');
  if (!id) throw new Error('createText failed');
  const ytext = ((doc.getMap('objects').get(id) as Y.Map<unknown> | undefined)?.get('text'));
  if (ytext instanceof Y.Text && text.length > 0) {
    doc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, text);
    }, LOCAL_ORIGIN);
  }
  return id;
}

function makeSelection(ids: string[]): UseSelectionResult {
  return {
    ids: new Set(ids),
    editingId: null,
    click: vi.fn(),
    toggle: vi.fn(),
    setMany: vi.fn(),
    clear: vi.fn(),
    startEdit: vi.fn(),
    endEdit: vi.fn(),
  };
}

function makePointerEvent(type: string, x: number, y: number): Event {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

interface ObjectHarnessProps {
  id: string;
  editing?: boolean;
  selected?: boolean;
  onEndEdit?: () => void;
  onClearSelection?: (id: string) => void;
  undo?: ReturnType<typeof createUndo> | null;
}

function ObjectHarness({
  id,
  editing = true,
  selected = true,
  onEndEdit,
  onClearSelection,
  undo,
}: ObjectHarnessProps): JSX.Element | null {
  // Re-render on every doc change so remote deletions unmount the object
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    doc.on('update', force);
    return () => doc.off('update', force);
  }, [doc]);
  const obj = snapshot(doc).find((o) => o.id === id);
  if (!obj || obj.type !== 'text') return null;
  const text = obj as TextSnapshot;
  return (
    <TextObjectComponent
      obj={text}
      doc={doc}
      zoom={IDENTITY.zoom}
      selected={selected}
      editing={editing}
      editable
      onPointerDown={() => {}}
      onStartEdit={() => {}}
      onEndEdit={onEndEdit ?? (() => {})}
      onClearSelection={onClearSelection}
      undo={undo ?? undefined}
    />
  );
}

function editor(scope: ParentNode): HTMLTextAreaElement {
  const ta = scope.querySelector('[data-testid="text-editor"]');
  expect(ta, 'text editor should be present').toBeTruthy();
  return ta as HTMLTextAreaElement;
}

function typeIn(ta: HTMLTextAreaElement, value: string) {
  act(() => {
    ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function objMap(id: string) {
  return doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
}

describe('TextObject component tests (story 9)', () => {
  it('TC-19: caret at end; Enter inserts a newline; Escape ends editing and keeps the text selected', () => {
    const id = makeText('hi');
    let ended = 0;
    let cleared: string | null = null;
    const { container } = render(
      <ObjectHarness
        id={id}
        onEndEdit={() => ended++}
        onClearSelection={(i) => (cleared = i)}
      />,
    );
    const ta = editor(container);
    // Caret at the end of the content
    expect(ta.selectionStart).toBe(ta.value.length);

    // Typing appends at the end
    typeIn(ta, 'hi there');
    const ytext = ((doc.getMap('objects').get(id) as Y.Map<unknown> | undefined)?.get('text')) as Y.Text;
    expect(ytext.toString()).toBe('hi there');

    // Enter inserts a newline (simulated: the browser puts '\n' at the caret)
    typeIn(ta, 'hi there\nline two');
    expect(ytext.toString()).toBe('hi there\nline two');

    // Escape ends editing, keeps the text, does not clear the selection
    fireEvent.keyDown(ta, { key: 'Escape', code: 'Escape' });
    expect(ended).toBe(1);
    expect(cleared).toBeNull(); // text kept → selection not cleared
    expect(ytext.toString()).toBe('hi there\nline two');
  });

  it('TC-20: Escape with no characters → object deleted, selection cleared', () => {
    const id = makeText('');
    let ended = 0;
    let cleared: string | null = null;
    render(
      <ObjectHarness
        id={id}
        onEndEdit={() => ended++}
        onClearSelection={(i) => (cleared = i)}
      />,
    );
    const ta = editor(document.body);
    fireEvent.keyDown(ta, { key: 'Escape', code: 'Escape' });

    expect(ended).toBe(1);
    expect(cleared).toBe(id);
    expect(objMap(id)).toBeUndefined(); // removed from the doc
  });

  it('TC-21: TextToolbar shows S M L XL with M pressed; clicking XL → setTextSize XL, x/y unchanged', () => {
    const id = makeText('hello', { x: 250, y: 350 });
    let onSize: string | null = null;
    const { container } = render(
      <TextToolbar
        size="M"
        onSize={(s) => {
          onSize = s;
          setTextSize(doc, id, s);
        }}
        onDelete={() => {}}
      />,
    );

    const btn = (label: string) =>
      container.querySelector(`[aria-label="Size ${label}"]`) as HTMLButtonElement;
    for (const s of ['S', 'M', 'L', 'XL']) {
      expect(btn(s), `button ${s}`).toBeTruthy();
    }
    expect(btn('M').getAttribute('aria-pressed')).toBe('true');
    expect(btn('XL').getAttribute('aria-pressed')).toBe('false');

    act(() => {
      btn('XL').click();
    });
    expect(onSize).toBe('XL');
    const obj = objMap(id)!;
    expect(obj.get('size')).toBe('XL');
    // Position unchanged
    expect(obj.get('x')).toBe(250);
    expect(obj.get('y')).toBe(350);
  });

  it('TC-22: selecting a single text shows only e and w handles', () => {
    const id = makeText('hello');
    const { container } = render(
      <SelectionOverlay
        ids={new Set([id])}
        snapshot={snapshot(doc)}
        camera={IDENTITY}
        onHandlePointerDown={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="handle-e"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="handle-w"]')).toBeTruthy();
    for (const h of ['n', 's', 'ne', 'nw', 'se', 'sw']) {
      expect(container.querySelector(`[data-testid="handle-${h}"]`), `no ${h} handle`).toBeNull();
    }
  });

  it('TC-23: text + sticky selection shows all handles; group resize repositions text, font size unchanged', () => {
    const id = makeText('hello', { x: 100, y: 100 });
    const objects = doc.getMap('objects');
    const sticky = new Y.Map();
    sticky.set('type', 'sticky');
    sticky.set('x', 300);
    sticky.set('y', 100);
    sticky.set('width', 200);
    sticky.set('height', 160);
    sticky.set('color', '#fde68a');
    sticky.set('text', new Y.Text('note'));
    sticky.set('createdBy', 'g_test');
    objects.set('sticky-1', sticky);

    const snap = snapshot(doc);
    const { container } = render(
      <SelectionOverlay
        ids={new Set([id, 'sticky-1'])}
        snapshot={snap}
        camera={IDENTITY}
        onHandlePointerDown={() => {}}
      />,
    );
    for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      expect(container.querySelector(`[data-testid="handle-${h}"]`), `handle ${h}`).toBeTruthy();
    }

    // Group resize via the gesture hook: drag the SE handle out by 100x50.
    // The text must stay at its proportional position (with a SE drag from
    // the top-left anchor it keeps x/y) and its font size must stay M.
    const { container: gContainer } = render(<GestureHarness ids={[id, 'sticky-1']} />);
    const se = gContainer.querySelector('[data-testid="handle-se"]') as HTMLElement;
    expect(se).toBeTruthy();
    // Group box: x=100..500, y=100..260 → SE corner at (500, 260)
    const startX = 500;
    const startY = 260;

    const before = objMap(id)!;
    const beforeX = before.get('x') as number;
    const beforeY = before.get('y') as number;

    act(() => {
      se.dispatchEvent(makePointerEvent('pointerdown', startX, startY));
    });
    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', startX + 100, startY + 50));
    });
    act(() => {
      vi.advanceTimersByTime(16); // fire the pending rAF frame
    });
    act(() => {
      window.dispatchEvent(makePointerEvent('pointerup', startX + 100, startY + 50));
    });

    const after = objMap(id)!;
    // Font size never changes via handles
    expect(after.get('size')).toBe('M');
    // SE drag: the top-left anchor is fixed, so the text keeps its position
    expect(after.get('x')).toBe(beforeX);
    expect(after.get('y')).toBe(beforeY);
    // The sticky actually grew
    const stickyAfter = objects.get('sticky-1') as Y.Map<unknown>;
    expect(stickyAfter.get('width')).toBeGreaterThan(200);
  });

  it('TC-24: remote delete during edit → editor unmounts, no errors, no recreation', () => {
    const id = makeText('being edited');
    const { container } = render(<ObjectHarness id={id} />);
    expect(editor(container)).toBeTruthy();

    // Remote peer deletes the object
    act(() => {
      doc.transact(() => {
        doc.getMap('objects').delete(id);
      }, 'remote-peer');
    });

    // The editor is gone (component unmounted) and the object was not
    // recreated
    expect(container.querySelector('[data-testid="text-editor"]')).toBeNull();
    expect(objMap(id)).toBeUndefined();
  });

  it('TC-25: type then Ctrl+Z → text and stored box revert together in one step', () => {
    const id = makeText('');
    const undo = createUndo(doc);
    const obj = objMap(id)!;
    const initialBox = {
      width: obj.get('width') as number,
      height: obj.get('height') as number,
    };

    const { container } = render(<ObjectHarness id={id} undo={undo} />);
    const ta = editor(container);

    // Type a word (one capture burst)
    typeIn(ta, 'hello');
    // The box was remeasured after typing (estimator in jsdom)
    expect(obj.get('width')).toBeGreaterThan(initialBox.width);

    // Ctrl+Z on the editor undoes the whole burst: text AND box revert
    fireEvent.keyDown(ta, { key: 'z', code: 'KeyZ', ctrlKey: true });
    const ytext = ((doc.getMap('objects').get(id) as Y.Map<unknown> | undefined)?.get('text')) as Y.Text;
    expect(ytext.toString()).toBe('');
    expect(obj.get('width')).toBeCloseTo(initialBox.width, 5);
    expect(obj.get('height')).toBeCloseTo(initialBox.height, 5);
    undo.destroy();
  });
});

/** Harness for the group-resize gesture test (TC-23). */
function GestureHarness({ ids }: { ids: string[] }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    doc.on('update', force);
    return () => doc.off('update', force);
  }, [doc]);
  const snap = snapshot(doc);
  const selection = makeSelection(ids);
  const { onHandlePointerDown } = useTransformGesture({
    doc,
    camera: IDENTITY,
    selection,
    snapshot: snap,
    canEdit: true,
  });
  return (
    <SelectionOverlay
      ids={new Set(ids)}
      snapshot={snap}
      camera={IDENTITY}
      onHandlePointerDown={onHandlePointerDown}
    />
  );
}
