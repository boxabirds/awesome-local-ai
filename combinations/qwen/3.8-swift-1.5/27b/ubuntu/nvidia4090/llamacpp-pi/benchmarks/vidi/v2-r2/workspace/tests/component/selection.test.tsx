/**
 * Story 7 component tests (ui-component): multi-selection, marquee, group
 * transform gestures, keyboard commands, selection UI.
 *
 * Camera in all tests is the default { x: -640, y: -400, zoom: 1 }, i.e.
 * screen = world + (640, 400). A 200×200 sticky centred on world (0,0)
 * occupies screen (540,300)-(740,500) with centre (640,400).
 */
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { act, screen, render } from '@testing-library/react';
import * as Y from 'yjs';

import {
  initDoc,
  createSticky,
  deleteObjects,
  objectSnapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import type { Camera } from '../../src/client/canvas/camera';
import { renderApp, getNote, flushRaf } from './sticky-helpers';
import { createPointerEvent } from './helpers';
import { getObjectType } from '../../src/client/objects/registry';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { useDocObjects } from '../../src/client/board/useBoardDoc';
import { createTestBox, registerTestBox } from '../fixtures/testbox';

type Pt = { clientX: number; clientY: number };

function at(clientX: number, clientY: number): Pt {
  return { clientX, clientY };
}

/**
 * Press and release on an element. The up-event is dispatched on the element
 * itself so it bubbles through the container's React handlers AND up to the
 * window listeners the gesture hook attaches (like a real pointer capture
 * release in the browser).
 */
function pressAndRelease(el: HTMLElement, pt: Pt, shiftKey = false) {
  act(() => {
    el.dispatchEvent(createPointerEvent('pointerdown', { ...pt, pointerId: 1, button: 0, shiftKey }));
  });
  act(() => {
    el.dispatchEvent(createPointerEvent('pointerup', { ...pt, pointerId: 1, button: 0 }));
  });
}

function viewport(): HTMLElement {
  return document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
}

function worldLayerTransform(): string {
  return (document.querySelector('[data-testid="world-layer"]') as HTMLElement).style.transform;
}

/** Creates three stickies in a row and returns their ids (a left, b middle, c far right). */
function threeNotes(doc: Y.Doc): [string, string, string] {
  let a = '';
  let b = '';
  let c = '';
  act(() => {
    a = createSticky(doc, { x: 0, y: 0 }) as string;
    b = createSticky(doc, { x: 300, y: 0 }) as string;
    c = createSticky(doc, { x: 900, y: 0 }) as string;
  });
  return [a, b, c];
}

describe('selection.ui (ui-component)', () => {
  it('TC-16: shift-click builds a multi-selection; remote delete prunes it', () => {
    const app = renderApp();
    const doc = app.getDoc();
    const [a, b, c] = threeNotes(doc);

    // Click a → {a}
    pressAndRelease(getNote(a)!, at(640, 400));
    expect(getNote(a)!.hasAttribute('data-selected')).toBe(true);
    expect(getNote(b)!.hasAttribute('data-selected')).toBe(false);

    // Shift-click b → {a, b}
    pressAndRelease(getNote(b)!, at(940, 400), true);
    expect(getNote(a)!.hasAttribute('data-selected')).toBe(true);
    expect(getNote(b)!.hasAttribute('data-selected')).toBe(true);
    expect(getNote(c)!.hasAttribute('data-selected')).toBe(false);

    // Remote (direct model) delete of everything → selection pruned, no UI.
    act(() => {
      deleteObjects(doc, [a, b, c]);
    });
    expect(document.querySelector('[data-selected="true"]')).toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-17: 2 selected → selection bar with count (aria-live) and delete', () => {
    const app = renderApp();
    const doc = app.getDoc();
    const [a, b] = threeNotes(doc);

    pressAndRelease(getNote(a)!, at(640, 400));
    pressAndRelease(getNote(b)!, at(940, 400), true);

    const bar = screen.getByTestId('selection-bar');
    expect(bar).not.toBeNull();
    const live = screen.getByText('2 selected');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Delete selection' })).not.toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-18: exactly 1 selected → note toolbar, no bar', () => {
    const app = renderApp();
    const doc = app.getDoc();
    const [a] = threeNotes(doc);

    pressAndRelease(getNote(a)!, at(640, 400));

    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-19: empty click clears the selection', () => {
    const app = renderApp();
    const doc = app.getDoc();
    const [a, b] = threeNotes(doc);

    pressAndRelease(getNote(a)!, at(640, 400));
    pressAndRelease(getNote(b)!, at(940, 400), true);
    expect(screen.getByTestId('selection-bar')).not.toBeNull();

    pressAndRelease(viewport(), at(200, 200));

    expect(document.querySelector('[data-selected="true"]')).toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-20: shift-drag marquee adds fully-inside notes to the current selection', async () => {
    const app = renderApp();
    const doc = app.getDoc();
    const [a, b, c] = threeNotes(doc);
    // a: screen x 540-740; b: 840-1040; c: 1540-1740 (all y 300-500)

    pressAndRelease(getNote(a)!, at(640, 400)); // {a}

    // Shift-drag marquee from (500,260) to (1100,540):
    // world (-140,-140)-(460,140) fully contains a and b, not c.
    const vp = viewport();
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointerdown', { ...at(500, 260), shiftKey: true, pointerId: 1, button: 0 }));
    });
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointermove', { ...at(800, 400), pointerId: 1 }));
    });
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointermove', { ...at(1100, 540), pointerId: 1 }));
    });
    expect(screen.queryByTestId('marquee-rect')).not.toBeNull();
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointerup', { ...at(1100, 540), pointerId: 1 }));
    });

    expect(getNote(a)!.hasAttribute('data-selected')).toBe(true);
    expect(getNote(b)!.hasAttribute('data-selected')).toBe(true);
    expect(getNote(c)!.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  it('TC-21: plain drag on the background pans (no marquee)', () => {
    renderApp();
    const before = worldLayerTransform();

    const vp = viewport();
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointerdown', { ...at(200, 200), pointerId: 1, button: 0 }));
    });
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointermove', { ...at(250, 250), pointerId: 1 }));
    });
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointerup', { ...at(250, 250), pointerId: 1 }));
    });

    expect(worldLayerTransform()).not.toBe(before);
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  it('TC-22: pointercancel during marquee → no selection change, no leftover rect', () => {
    const app = renderApp();
    const doc = app.getDoc();
    const [a, b] = threeNotes(doc);

    const vp = viewport();
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointerdown', { ...at(500, 260), shiftKey: true, pointerId: 1, button: 0 }));
    });
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointermove', { ...at(1100, 540), pointerId: 1 }));
    });
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointercancel', { ...at(1100, 540), pointerId: 1 }));
    });

    expect(getNote(a)!.hasAttribute('data-selected')).toBe(false);
    expect(getNote(b)!.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  it('TC-27: Ctrl+A selects every object and prevents the default', () => {
    const app = renderApp();
    const doc = app.getDoc();
    const [a, b, c] = threeNotes(doc);

    let prevented = false;
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      prevented = e.defaultPrevented;
    });

    expect(prevented).toBe(true);
    expect(getNote(a)!.hasAttribute('data-selected')).toBe(true);
    expect(getNote(b)!.hasAttribute('data-selected')).toBe(true);
    expect(getNote(c)!.hasAttribute('data-selected')).toBe(true);
  });

  it('TC-28: Ctrl+A with no objects → nothing selected, no crash', () => {
    renderApp();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[data-selected="true"]')).toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-29: arrows nudge 1 world unit, Shift+arrow 10; default prevented; no page scroll', () => {
    const app = renderApp();
    const doc = app.getDoc();
    const [a] = threeNotes(doc);
    pressAndRelease(getNote(a)!, at(640, 400));

    const pos = () => objectSnapshot(doc).find((o) => o.id === a)!;
    const before = pos();
    expect(before.x).toBe(-100);
    expect(before.y).toBe(-100);

    let prevented = false;
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      prevented = e.defaultPrevented;
    });
    expect(prevented).toBe(true);
    expect(pos().x).toBe(-99);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(pos().y).toBe(-110);

    expect(window.scrollY).toBe(0);
  });

  it('TC-30: Backspace while editing deletes a character, not the selection', () => {
    const app = renderApp();
    const doc = app.getDoc();
    const [a] = threeNotes(doc);
    pressAndRelease(getNote(a)!, at(640, 400));

    // Enter starts editing.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    expect(editor).not.toBeNull();

    // Type a character (value + input event sync the Y.Text).
    act(() => {
      editor.value = 'hi';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Backspace inside the editor must not delete the note.
    act(() => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    });
    expect(objectSnapshot(doc).find((o) => o.id === a)).toBeDefined();
    expect(getNote(a)).not.toBeNull();
  });

  it('TC-31: Delete key deletes the whole selection and clears it', () => {
    const app = renderApp();
    const doc = app.getDoc();
    const [a, b, c] = threeNotes(doc);
    pressAndRelease(getNote(a)!, at(640, 400));
    pressAndRelease(getNote(b)!, at(940, 400), true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    });

    const ids = objectSnapshot(doc).map((o) => o.id);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(b);
    expect(ids).toContain(c);
    expect(document.querySelector('[data-selected="true"]')).toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transform gesture harness: object layer + overlay + gesture, with a fixed
// camera {x:-640,y:-400,zoom:1} and controllable canEdit/callbacks.
// ---------------------------------------------------------------------------

interface GestureApi {
  selection: ReturnType<typeof useSelection>;
}

function GestureHarness(props: {
  doc: Y.Doc;
  canEdit?: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  api: { current: GestureApi | null };
}) {
  const { doc, canEdit = true, onGestureStart, onGestureEnd, api } = props;
  const objects = useDocObjects(doc);
  const camera: Camera = { x: -640, y: -400, zoom: 1 };
  const selection = useSelection(objects);
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit,
    onGestureStart,
    onGestureEnd,
  });
  useEffect(() => {
    api.current = { selection };
  });

  return (
    <div style={{ position: 'relative', width: 1280, height: 800 }}>
      <div style={{ position: 'absolute', left: 640, top: 400 }}>
        {objects.map((o) => {
          const spec = getObjectType(o.type);
          if (!spec) return null;
          const C = spec.Component;
          return (
            <C
              key={o.id}
              obj={o}
              doc={doc}
              z={o.z}
              zoom={1}
              selected={selection.ids.has(o.id)}
              editing={false}
              editable={canEdit}
              onPointerDown={gesture.onObjectPointerDown}
              onStartEdit={() => {}}
              onEndEdit={() => {}}
            />
          );
        })}
      </div>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
    </div>
  );
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function startDragOn(el: HTMLElement, pt: Pt) {
  act(() => {
    el.dispatchEvent(createPointerEvent('pointerdown', { ...pt, pointerId: 7, button: 0 }));
  });
}

function moveWindow(pt: Pt, shiftKey = false) {
  act(() => {
    window.dispatchEvent(createPointerEvent('pointermove', { ...pt, pointerId: 7, shiftKey }));
  });
}

function endDrag() {
  act(() => {
    window.dispatchEvent(createPointerEvent('pointerup', { pointerId: 7, button: 0 }));
  });
}

function cancelDrag() {
  act(() => {
    window.dispatchEvent(createPointerEvent('pointercancel', { pointerId: 7 }));
  });
}

function obj(doc: Y.Doc, id: string): ObjectSnapshot {
  const o = objectSnapshot(doc).find((s) => s.id === id);
  if (!o) throw new Error(`object ${id} not found`);
  return o;
}

describe('transform gestures (ui-component)', () => {
  it('TC-23: drag of an unselected object replaces the selection; <2px is a click', async () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string; // screen 540-740
    const b = createSticky(doc, { x: 300, y: 0 }) as string; // screen 840-1040
    const api: { current: GestureApi | null } = { current: null };
    act(() => {
      render(<GestureHarness doc={doc} api={api} />);
    });

    // Select a.
    pressAndRelease(getNote(a)!, at(640, 400));
    expect(api.current!.selection.ids.has(a)).toBe(true);

    // Pressing b replaces the selection; a 2px move stays a click (no write).
    startDragOn(getNote(b)!, at(940, 400));
    moveWindow(at(942, 400));
    endDrag();
    await flushRaf();
    expect(obj(doc, b).x).toBe(200);
    expect(api.current!.selection.ids.size).toBe(1);
    expect(api.current!.selection.ids.has(b)).toBe(true);
    expect(api.current!.selection.ids.has(a)).toBe(false);

    // 3px move on b → drag: selection becomes {b}, b moves by 3, a untouched.
    startDragOn(getNote(b)!, at(940, 400));
    moveWindow(at(943, 400));
    await flushRaf();
    endDrag();
    await flushRaf();
    expect(api.current!.selection.ids.size).toBe(1);
    expect(api.current!.selection.ids.has(b)).toBe(true);
    expect(api.current!.selection.ids.has(a)).toBe(false);
    expect(obj(doc, b).x).toBe(203);
    expect(obj(doc, a).x).toBe(-100);
  });

  it('TC-24: testbox e-handle scales width only; Shift scales both; all 8 handles exist', async () => {
    registerTestBox();
    const doc = makeDoc();
    const t = createTestBox(doc, 0, 0, 200, 100);
    const api: { current: GestureApi | null } = { current: null };
    act(() => {
      render(<GestureHarness doc={doc} api={api} />);
    });

    pressAndRelease(getNote(t)!, at(740, 450));

    for (const label of [
      'top-left',
      'top',
      'top-right',
      'right',
      'bottom-right',
      'bottom',
      'bottom-left',
      'left',
    ]) {
      expect(screen.getByLabelText(`Resize ${label}`)).not.toBeNull();
    }

    // Plain e-drag: +100px x → width 300, height 100.
    const eHandle = screen.getByLabelText('Resize right');
    act(() => {
      eHandle.dispatchEvent(createPointerEvent('pointerdown', { ...at(840, 450), pointerId: 7, button: 0 }));
    });
    moveWindow(at(940, 450));
    await flushRaf();
    endDrag();
    await flushRaf();
    let o = obj(doc, t);
    expect(o.width).toBe(300);
    expect(o.height).toBe(100);
    expect(o.x).toBe(0);
    expect(o.y).toBe(0);

    // Shift e-drag on a second box: aspect-locked, both scale (scale = 1.5).
    let t2 = '';
    act(() => {
      t2 = createTestBox(doc, 0, 300, 200, 100); // screen 640-840 × 700-800
    });
    act(() => {
      getNote(t2)!.dispatchEvent(createPointerEvent('pointerdown', { ...at(740, 750), pointerId: 7, button: 0 }));
    });
    act(() => {
      window.dispatchEvent(createPointerEvent('pointerup', { pointerId: 7, button: 0 }));
    });
    const e2 = screen.getByLabelText('Resize right');
    act(() => {
      e2.dispatchEvent(createPointerEvent('pointerdown', { ...at(840, 750), pointerId: 7, button: 0 }));
    });
    moveWindow(at(940, 750), true);
    await flushRaf();
    endDrag();
    await flushRaf();
    const o2 = obj(doc, t2);
    expect(o2.width).toBe(300);
    expect(o2.height).toBe(150);
  });

  it('TC-25: read-only (!canEdit) — drag produces no doc writes', async () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const api: { current: GestureApi | null } = { current: null };
    act(() => {
      render(<GestureHarness doc={doc} canEdit={false} api={api} />);
    });

    // Selection still works (read-only boards show selection UI per design).
    pressAndRelease(getNote(a)!, at(640, 400));
    expect(api.current!.selection.ids.has(a)).toBe(true);

    startDragOn(getNote(a)!, at(640, 400));
    moveWindow(at(700, 430));
    await flushRaf();
    endDrag();
    await flushRaf();

    expect(obj(doc, a).x).toBe(-100);
    expect(obj(doc, a).y).toBe(-100);
  });

  it('TC-26: onGestureStart/End fire per drag; pointercancel preserves the last applied position', async () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const api: { current: GestureApi | null } = { current: null };
    let starts = 0;
    let ends = 0;
    act(() => {
      render(
        <GestureHarness
          doc={doc}
          api={api}
          onGestureStart={() => starts++}
          onGestureEnd={() => ends++}
        />
      );
    });

    pressAndRelease(getNote(a)!, at(640, 400));
    const endsAfterClick = ends; // a click also reports end (always, per contract)

    // Drag 1: +10px.
    startDragOn(getNote(a)!, at(640, 400));
    moveWindow(at(650, 400));
    await flushRaf();
    endDrag();
    await flushRaf();
    expect(starts).toBe(1);
    expect(ends).toBe(endsAfterClick + 1);
    expect(obj(doc, a).x).toBe(-90);

    // Drag 2: +5px.
    startDragOn(getNote(a)!, at(650, 400));
    moveWindow(at(655, 400));
    await flushRaf();
    endDrag();
    await flushRaf();
    expect(starts).toBe(2);
    expect(ends).toBe(endsAfterClick + 2);
    expect(obj(doc, a).x).toBe(-85);

    // Drag 3 cancelled mid-way: the last applied position survives.
    startDragOn(getNote(a)!, at(655, 400));
    moveWindow(at(660, 400));
    await flushRaf(); // applies +5 → x = -80
    const afterApply = obj(doc, a).x;
    cancelDrag();
    await flushRaf();
    expect(starts).toBe(3);
    expect(ends).toBe(endsAfterClick + 3);
    expect(obj(doc, a).x).toBe(afterApply);
  });
});
