// Story 7, sel.transform — what a selection looks like: outlines on every object,
// one bounding box, eight handles, and a bar floating above it. All of it is
// drawn in SCREEN space, so the strokes and handles keep their pixel size at any
// zoom while the geometry follows the camera.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  renderBoard7,
  seedSticky,
  seedBox,
  act,
  fireEvent,
  screen,
} from './story7TestUtils.tsx';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry.tsx';
import { objectsMapOf } from '../../src/shared/board-model.ts';
import { HANDLE_SIZE_PX } from '../../src/shared/config.ts';

// A second test-only type, this one NOT resizable, to prove the handles come from
// the registry flag and not from the shape of the selection.
function PlainDot(props: ObjectProps): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label="Plain dot"
      data-testid={`dot-${props.obj.id}`}
      data-object-id={props.obj.id}
      data-selected={props.selected}
      style={{ position: 'absolute', left: props.obj.x, top: props.obj.y, width: 40, height: 40 }}
      onPointerDown={(e) => props.onObjectPointerDown(e, props.obj.id)}
    />
  );
}
registerObjectType('plaindot', {
  Component: PlainDot,
  resizable: false,
  aspectLocked: false,
  minSize: 10,
  editableText: false,
  hitTest: () => true,
});

const overlay = () => document.querySelector<HTMLElement>('.selection-overlay');
const outlines = () => Array.from(document.querySelectorAll<HTMLElement>('.selection-outline'));
const box = () => screen.queryByTestId('selection-box');
const px = (el: Element, prop: string) => parseFloat((el as HTMLElement).style[prop as 'left'] ?? '');

// Zoom the board in with its own keyboard control and report the zoom reached.
async function zoomedIn(steps: number): Promise<number> {
  for (let i = 0; i < steps; i++) {
    fireEvent.keyDown(window, { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
  }
  await act(async () => {
    await new Promise<void>((res) => requestAnimationFrame(() => res()));
    await Promise.resolve();
  });
  return Number(screen.getByTestId('world-layer').getAttribute('data-cam-zoom'));
}

// Seed a plain dot (a registered, non-resizable type) into the model's object
// map, which is where every object lives.
function seedPlain(h: ReturnType<typeof renderBoard7>, x: number, y: number): string {
  let id = '';
  act(() => {
    id = `dot-${Math.random().toString(36).slice(2, 8)}`;
    const m = new Y.Map<unknown>();
    m.set('type', 'plaindot');
    m.set('x', x);
    m.set('y', y);
    m.set('z', 1);
    m.set('createdAt', 0);
    objectsMapOf(h.doc()).set(id, m);
  });
  return id;
}

describe('selection overlay (sel.transform)', () => {
  // Nothing selected: the overlay does not exist at all.
  it('draws nothing while the selection is empty', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 0, y: 0 });

    expect(overlay()).toBeNull();
    expect(outlines()).toHaveLength(0);
    expect(box()).toBeNull();
    expect(h.handles()).toHaveLength(0);
    expect(h.view.queryByTestId('selection-bar')).toBeNull();
  });

  // One object: an outline on the object itself, in screen pixels, plus the
  // object's own data-selected flag for its component to style with.
  it('outlines the selected object in screen space', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 100, y: 50 });
    h.press(h.object(a), 300, 300);
    h.release(h.object(a), 300, 300);

    const outline = document.querySelector<HTMLElement>(`.selection-outline[data-object-id="${a}"]`);
    expect(outline).not.toBeNull();
    expect(outline!.getAttribute('data-selected')).toBe('true');
    expect(outline!.getAttribute('aria-hidden')).toBe('true');
    const zoom = h.cam().zoom;
    const at = h.toScreen({ x: 100, y: 50 });
    expect(px(outline!, 'left')).toBeCloseTo(at.x, 3);
    expect(px(outline!, 'top')).toBeCloseTo(at.y, 3);
    expect(px(outline!, 'width')).toBeCloseTo(200 * zoom, 3);
    expect(px(outline!, 'height')).toBeCloseTo(200 * zoom, 3);
    expect(outlines()).toHaveLength(1);

    // The object itself is marked too, and the overlay is not inside the world
    // layer (that is what keeps its strokes at screen size).
    expect(h.object(a)).toHaveAttribute('data-selected', 'true');
    expect(overlay()!.closest('[data-testid="world-layer"]')).toBeNull();
  });

  // Several objects: an outline for each one plus one box around them all, in
  // world extents projected to screen.
  it('draws one bounding box around a whole selection', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    const b = seedSticky(h.doc(), { x: 600, y: 400 });
    h.press(h.object(a), 100, 100);
    h.release(h.object(a), 100, 100);
    h.press(h.object(b), 700, 500, { shiftKey: true, pointerId: 2 });
    h.release(h.object(b), 700, 500, { shiftKey: true, pointerId: 2 });

    expect(outlines()).toHaveLength(2);
    const sel = box()!;
    expect(sel.getAttribute('aria-hidden')).toBe('true');
    const zoom = h.cam().zoom;
    const from = h.toScreen({ x: 0, y: 0 });
    expect(px(sel, 'left')).toBeCloseTo(from.x, 3);
    expect(px(sel, 'width')).toBeCloseTo((600 + 200 - 0) * zoom, 3);
    expect(px(sel, 'height')).toBeCloseTo((400 + 200 - 0) * zoom, 3);
    expect(overlay()!.getAttribute('data-selection-count')).toBe('2');
  });

  // Eight handles, each a keyboard-focusable button with the accessible name
  // from the contract, each HANDLE_SIZE_PX on a side.
  it('gives a resizable selection eight named handles', () => {
    const h = renderBoard7();
    const boxId = seedBox(h.doc(), { x: 0, y: 0, width: 200, height: 100 });
    h.press(h.object(boxId), 100, 100);
    h.release(h.object(boxId), 100, 100);

    const handles = h.handles();
    expect(handles.map((el) => el.getAttribute('data-handle')).sort()).toEqual(
      ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'].sort(),
    );
    for (const el of handles) {
      expect(el).toHaveAttribute('role', 'button');
      expect(el).toHaveAttribute('tabindex', '0');
      expect(el.getAttribute('aria-label')).toMatch(/^Resize /);
      expect(el.getAttribute('aria-label')).not.toBe('');
      expect(px(el, 'width')).toBe(HANDLE_SIZE_PX);
      expect(px(el, 'height')).toBe(HANDLE_SIZE_PX);
    }
    expect(handles.map((el) => el.getAttribute('aria-label')).sort()).toEqual(
      [
        'Resize bottom',
        'Resize bottom left',
        'Resize bottom right',
        'Resize left',
        'Resize right',
        'Resize top',
        'Resize top left',
        'Resize top right',
      ].sort(),
    );
  });

  // The screen-space promise: zoom in and the geometry follows the camera while
  // the handle keeps its pixel size, so it stays grabbable at every zoom.
  it('keeps handles the same pixel size while the geometry zooms', async () => {
    const h = renderBoard7();
    const boxId = seedBox(h.doc(), { x: 0, y: 0, width: 200, height: 100 });
    h.press(h.object(boxId), 100, 100);
    h.release(h.object(boxId), 100, 100);

    const before = h.handle('se');
    expect(px(before, 'width')).toBe(HANDLE_SIZE_PX);

    const zoom = await zoomedIn(3);
    expect(zoom).toBeGreaterThan(1);

    const after = h.handle('se');
    expect(px(after, 'width')).toBe(HANDLE_SIZE_PX);
    // The bottom-right corner of the box, projected: where the handle belongs.
    const corner = h.toScreen({ x: 200, y: 100 });
    expect(px(after, 'left')).toBeCloseTo(corner.x - HANDLE_SIZE_PX / 2, 2);
    expect(px(after, 'top')).toBeCloseTo(corner.y - HANDLE_SIZE_PX / 2, 2);

    const outline = document.querySelector<HTMLElement>(`.selection-outline[data-object-id="${boxId}"]`)!;
    expect(px(outline, 'width')).toBeCloseTo(200 * zoom, 2);
  });

  // A selected object whose type cannot be resized gets an outline and no
  // handles: the registry decides, not the size of the selection.
  it('shows no handles for a type that is not resizable', () => {
    const h = renderBoard7();
    const dot = seedPlain(h, 300, 300);
    h.press(h.object(dot), 100, 100);
    h.release(h.object(dot), 100, 100);

    expect(h.object(dot)).toHaveAttribute('data-selected', 'true');
    expect(outlines()).toHaveLength(1);
    expect(h.handles()).toHaveLength(0);
    // A selection you cannot resize you can still move and still delete.
    expect(h.barDeleteButton()).not.toBeNull();
    expect(h.selectionCount()).toBe('1 selected');
  });

  // A mixed selection: one resizable type among the selected objects is enough
  // to bring the handles out.
  it('shows handles when any selected type is resizable', () => {
    const h = renderBoard7();
    const dot = seedPlain(h, 0, 0);
    const boxId = seedBox(h.doc(), { x: 400, y: 0, width: 100, height: 100 });
    h.press(h.object(dot), 50, 50);
    h.release(h.object(dot), 50, 50);
    h.press(h.object(boxId), 450, 50, { shiftKey: true, pointerId: 2 });
    h.release(h.object(boxId), 450, 50, { shiftKey: true, pointerId: 2 });

    expect(outlines()).toHaveLength(2);
    expect(h.handles()).toHaveLength(8);
  });

  // The bar floats above the box in screen space and says how many there are.
  it('floats the bar above the selection box', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    const b = seedSticky(h.doc(), { x: 600, y: 400 });
    h.press(h.object(a), 100, 100);
    h.release(h.object(a), 100, 100);
    h.press(h.object(b), 700, 500, { shiftKey: true, pointerId: 2 });
    h.release(h.object(b), 700, 500, { shiftKey: true, pointerId: 2 });

    const bar = h.view.getByTestId('selection-bar');
    expect(bar.getAttribute('data-selection-count')).toBe('2');
    expect(bar.closest('[data-testid="world-layer"]')).toBeNull();
    const zoom = h.cam().zoom;
    // Centred over the box's top edge: (0 + 800) / 2 = 400 world units.
    expect(px(bar, 'left')).toBeCloseTo(h.toScreen({ x: 400, y: 0 }).x, 2);
    expect(px(bar, 'top')).toBeLessThan(h.toScreen({ x: 0, y: 0 }).y);
    expect(zoom).toBe(1);
  });
});
