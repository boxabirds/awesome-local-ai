import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act, cleanup } from '@testing-library/react';
import { renderFullApp, hooks, makeNote, firePointer, pressKey, typeText } from './story2';
import { createShape } from '@/shared/objects/shape';

// Story 5: the board page checks existence before rendering the board.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The shapes currently on the board (typed). */
function shapeSnaps() {
  return hooks().getObjects().filter((o) => o.type === 'shape');
}

function shapeButton(): HTMLButtonElement {
  return screen.getByTestId('shape-tool-button') as HTMLButtonElement;
}
function selectButton(): HTMLButtonElement {
  return screen.getByTestId('select-tool-button') as HTMLButtonElement;
}

/** jsdom window is 1024x768; initial camera (-512,-384), zoom 1: screen = world + (512, 384). */
const S = (wx: number, wy: number): { x: number; y: number } => ({ x: wx + 512, y: wy + 384 });

describe('story 10: shape tool (shape.tool, ui-component)', () => {
  it('TC-15: drag with the S tool previews then creates exactly one shape and selects it', async () => {
    await renderFullApp();
    pressKey(window, 's');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');
    const overlay = screen.getByTestId('shape-tool-overlay');

    // Drag from world (100,100) to world (300,220) -> rect (100,100,200,120).
    firePointer(overlay, 'pointerdown', S(100, 100).x, S(100, 100).y);
    // A dashed preview follows the pointer.
    expect(screen.getByTestId('shape-preview')).toBeTruthy();
    firePointer(overlay, 'pointermove', S(300, 220).x, S(300, 220).y);
    firePointer(overlay, 'pointerup', S(300, 220).x, S(300, 220).y);

    const shapes = shapeSnaps();
    expect(shapes).toHaveLength(1);
    const s = shapes[0];
    expect(s.x).toBe(100);
    expect(s.y).toBe(100);
    expect(s.width).toBe(200);
    expect(s.height).toBe(120);
    expect(s.kind).toBe('rect');
    expect(s.fill).toBe('white');
    expect(s.stroke).toBe('dark');
    expect(s.label).toBe('');

    // The new shape is selected and the tool returned to Select.
    expect(hooks().getSelection()).toEqual([s.id]);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('shape-tool-overlay')).toBeNull();
  });

  it('TC-16: double-click edits the label and it is clamped to 500 characters', async () => {
    await renderFullApp();
    pressKey(window, 's');
    const overlay = screen.getByTestId('shape-tool-overlay');

    // A click (no meaningful drag) creates the default 160x160 square centred
    // on the press point.
    firePointer(overlay, 'pointerdown', S(186, 116).x, S(186, 116).y);
    firePointer(overlay, 'pointerup', S(186, 116).x, S(186, 116).y);

    const shapes = shapeSnaps();
    expect(shapes).toHaveLength(1);
    const id = shapes[0].id;
    expect(shapes[0].width).toBe(160);
    expect(shapes[0].height).toBe(160);
    expect(shapes[0].x).toBe(106);
    expect(shapes[0].y).toBe(36);

    // Double-click enters editing.
    const el = document.querySelector(`[data-testid="shape"][data-id="${id}"]`);
    if (el === null) throw new Error('shape element not found');
    act(() => {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    const ta = screen.getByTestId('shape-label-textarea') as HTMLTextAreaElement;

    // 600 characters clamp to the 500-character limit.
    typeText(ta, 'a'.repeat(600));
    const label = hooks().getObjects().find((o) => o.id === id)?.label;
    expect(label).toBe('a'.repeat(500));

    // Escape (on the editor) ends editing; the label survives.
    pressKey(ta, 'Escape');
    expect(screen.queryByTestId('shape-label-textarea')).toBeNull();
    expect(hooks().getObjects().find((o) => o.id === id)?.label).toBe('a'.repeat(500));
  });

  it('TC-17: the selected shape toolbar applies fill and stroke without touching label or selection', async () => {
    await renderFullApp();

    // Create a shape through the model (as a remote would) and select it.
    let id = '';
    act(() => {
      id = createShape(
        hooks().getDoc(),
        { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } },
        'tester',
      )!;
    });
    const before = hooks().getObjects().find((o) => o.id === id)!;
    const shapeEl = document.querySelector(`[data-testid="shape"][data-id="${id}"]`);
    if (shapeEl === null) throw new Error('shape element not found');
    firePointer(shapeEl, 'pointerdown', S(200, 160).x, S(200, 160).y);
    firePointer(shapeEl, 'pointerup', S(200, 160).x, S(200, 160).y);
    expect(hooks().getSelection()).toEqual([id]);

    // The shape toolbar is shown for the single selected shape.
    const toolbar = screen.getByTestId('shape-toolbar');
    expect(toolbar).toBeTruthy();

    act(() => {
      (screen.getByTestId('shape-fill-blue') as HTMLButtonElement).click();
    });
    act(() => {
      (screen.getByTestId('shape-stroke-red') as HTMLButtonElement).click();
    });

    const after = hooks().getObjects().find((o) => o.id === id)!;
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    // Label and selection are unchanged by a style change.
    expect(after.label).toBe(before.label ?? '');
    expect(hooks().getSelection()).toEqual([id]);
  });

  it('TC-28: dragging from over an object with the Shape tool creates a shape, not a move', async () => {
    await renderFullApp();

    // A sticky note centred at world (100,100): rect (0,0,200,200).
    const noteId = makeNote(100, 100);
    expect(hooks().getNotes().find((n) => n.id === noteId)!.x).toBe(0);
    expect(hooks().getNotes().find((n) => n.id === noteId)!.y).toBe(0);

    // Press the Shape tool and drag starting right over the note's centre.
    pressKey(window, 's');
    const overlay = screen.getByTestId('shape-tool-overlay');
    firePointer(overlay, 'pointerdown', S(100, 100).x, S(100, 100).y);
    firePointer(overlay, 'pointermove', S(300, 220).x, S(300, 220).y);
    firePointer(overlay, 'pointerup', S(300, 220).x, S(300, 220).y);

    // A shape was created at the drag rect...
    const shapes = shapeSnaps();
    expect(shapes).toHaveLength(1);
    expect(shapes[0].x).toBe(100);
    expect(shapes[0].y).toBe(100);
    expect(shapes[0].width).toBe(200);
    expect(shapes[0].height).toBe(120);
    // ...and the note did not move (the tool owns the gesture).
    const note = hooks().getNotes().find((n) => n.id === noteId)!;
    expect(note.x).toBe(0);
    expect(note.y).toBe(0);
  });
});
