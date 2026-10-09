/**
 * Story 10, task 12: the Shape tool, the shape and its toolbar (TC-15, TC-16, TC-17, TC-28).
 *
 * These are the four things a person does with a shape and the one thing the Shape tool must
 * not do. The drag is done through the tool's own surface, because the surface *is* the tool:
 * it takes every press in the viewport while the tool is up, which is also the reason a drag
 * that starts on top of a sticky note cannot move that note (TC-28).
 */
import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import {
  VIEWPORT_FIXTURE,
  createNote,
  flushFrames,
  dragNote,
  notePosition,
  pressKey,
  renderBoard,
} from './fixtures/board';
import {
  clickOnSurface,
  clickShapeSwatch,
  drawShape,
  previewElement,
  pressToolKey,
  screenOf,
  selectedShapeIds,
  shapeElement,
  shapeToolbarElement,
  shapeToolSurface,
  shapesInDoc,
  shapeCentreOnScreen,
  shapeInDoc,
  seedShape,
  clickShapeTool,
  toolPressed,
  waitForShapes,
} from './fixtures/shapes';

/** Type into the shape's own editor, the way a keyboard does. */
function typeIntoShape(text: string): void {
  const editor = document.querySelector<HTMLTextAreaElement>('[data-testid="shape-editor"]');
  if (!editor) throw new Error('no shape label editor is mounted');
  act(() => {
    editor.value += text;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function shapeEditorElement(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('[data-testid="shape-editor"]');
}

describe('drawing a shape (TC-15)', () => {
  it('TC-15: a drag shows a preview, writes exactly one shape, selects it and puts Select back', async () => {
    await renderBoard();
    await clickShapeTool();
    expect(toolPressed('[data-testid="tool-shape"]')).toBe(true);
    expect(toolPressed('[data-testid="tool-select"]')).toBe(false);

    const from = { x: 300, y: 220 };
    const to = { x: 500, y: 340 };
    const surface = shapeToolSurface();
    act(() => {
      surface.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: from.x,
          clientY: from.y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 1,
        }),
      );
    });
    act(() => {
      surface.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: to.x,
          clientY: to.y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 1,
        }),
      );
    });
    await flushFrames();

    // The box the person is dragging, on screen, while they drag it.
    const preview = previewElement();
    expect(preview).not.toBeNull();
    expect(preview?.dataset.previewWidth).toBe('200');
    expect(preview?.dataset.previewHeight).toBe('120');

    act(() => {
      surface.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: to.x,
          clientY: to.y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 0,
        }),
      );
    });
    await flushFrames();

    const shapes = await waitForShapes(1);
    const [shape] = shapes;
    expect(shape.width).toBeCloseTo(200, 6);
    expect(shape.height).toBeCloseTo(120, 6);
    // Exactly where the drag went: (300, 220) on screen is (-340, -180) on the board.
    expect(shape.x).toBeCloseTo(from.x - VIEWPORT_FIXTURE.width / 2, 6);
    expect(shape.y).toBeCloseTo(from.y - VIEWPORT_FIXTURE.height / 2, 6);
    // Selected on this tab, and no second shape appeared.
    expect(selectedShapeIds()).toEqual([shape.id]);
    expect(shapesInDoc()).toHaveLength(1);
    // The preview is gone with the drag, and so is the tool.
    expect(previewElement()).toBeNull();
    expect(toolPressed('[data-testid="tool-shape"]')).toBe(false);
    expect(toolPressed('[data-testid="tool-select"]')).toBe(true);
  });

  it('a press that is cancelled writes no shape and leaves the tool up', async () => {
    await renderBoard();
    await clickShapeTool();
    const surface = shapeToolSurface();
    act(() => {
      surface.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: 400,
          clientY: 300,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 1,
        }),
      );
    });
    act(() => {
      surface.dispatchEvent(
        new PointerEvent('pointercancel', {
          bubbles: true,
          clientX: 460,
          clientY: 360,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 0,
        }),
      );
    });
    await flushFrames();
    expect(shapesInDoc()).toHaveLength(0);
    expect(toolPressed('[data-testid="tool-shape"]')).toBe(true);
  });

  it('a click with no drag makes a standard shape centred on the point', async () => {
    await renderBoard();
    const at = { x: 500, y: 300 };
    const id = await drawShape(at);
    const shape = shapeInDoc(id);
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    const centre = screenOf({ x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 });
    expect(centre.x).toBeCloseTo(at.x, 6);
    expect(centre.y).toBeCloseTo(at.y, 6);
  });
});

describe('typing in a shape (TC-16)', () => {
  it('TC-16: double-click opens the label editor, and 600 characters leave 500 in the document', async () => {
    await renderBoard();
    const id = seedShape({ x: -80, y: -80, width: 160, height: 160 });

    act(() => {
      shapeElement(id).dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          clientX: shapeCentreOnScreen(id).x,
          clientY: shapeCentreOnScreen(id).y,
        }),
      );
    });
    await flushFrames();

    expect(shapeEditorElement()).not.toBeNull();
    expect(shapeElement(id).dataset.editing).toBe('true');

    typeIntoShape('a'.repeat(SHAPE_LABEL_MAX_CHARS + 100));
    await flushFrames();

    // The document holds the limit, not the extra hundred.
    expect(shapeInDoc(id).label).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    // The editor itself is cut back to the limit, so what this person sees and what the
    // document holds are the same 500 characters — not 600 in the box and 500 in the file.
    expect(shapeEditorElement()?.value).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('Escape ends editing with the shape still selected', async () => {
    await renderBoard();
    const id = seedShape({ x: -80, y: -80, width: 160, height: 160 });
    const at = shapeCentreOnScreen(id);
    act(() => {
      shapeElement(id).dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }),
      );
    });
    await flushFrames();
    typeIntoShape('kept');
    const editor = shapeEditorElement();
    editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flushFrames();

    expect(shapeEditorElement()).toBeNull();
    expect(shapeInDoc(id).label).toBe('kept');
    expect(selectedShapeIds()).toEqual([id]);
  });

});

describe('the shape toolbar (TC-17)', () => {
  it('TC-17: a fill swatch and an outline swatch change colours, and nothing else', async () => {
    await renderBoard();
    const id = seedShape({ x: -80, y: -80, width: 160, height: 160 });
    // The label and the place it was drawn are the things that must not move.
    const at = shapeCentreOnScreen(id);
    act(() => {
      shapeElement(id).dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: at.x,
          clientY: at.y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 1,
        }),
      );
      shapeElement(id).dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          clientX: at.x,
          clientY: at.y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 0,
        }),
      );
    });
    await flushFrames();
    expect(selectedShapeIds()).toEqual([id]);
    expect(shapeToolbarElement()).not.toBeNull();

    clickShapeSwatch('shape-fill-blue');
    clickShapeSwatch('shape-stroke-red');
    await flushFrames();

    const shape = shapeInDoc(id);
    expect(shape.fill).toBe('blue');
    expect(shape.stroke).toBe('red');
    // The box, the position and the selection are as they were (PRD: shape.style).
    expect(shape.width).toBe(160);
    expect(shape.height).toBe(160);
    expect(shape.label).toBe('');
    expect(selectedShapeIds()).toEqual([id]);
    // The swatches say which colours are on the shape right now.
    expect(
      document.querySelector('[data-testid="shape-fill-blue"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      document.querySelector('[data-testid="shape-stroke-red"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('no toolbar appears for no selection, or for more than one shape', async () => {
    await renderBoard();
    const first = seedShape({ x: -300, y: -80, width: 120, height: 120 });
    const second = seedShape({ x: -100, y: -80, width: 120, height: 120 });
    expect(shapeToolbarElement()).toBeNull();

    // Shift-press adds the second shape, and two shapes get no swatches.
    for (const id of [first, second]) {
      const at = shapeCentreOnScreen(id);
      act(() => {
        shapeElement(id).dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            clientX: at.x,
            clientY: at.y,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: 1,
            shiftKey: id !== first,
          }),
        );
        shapeElement(id).dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            clientX: at.x,
            clientY: at.y,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: 0,
            shiftKey: id !== first,
          }),
        );
      });
      await flushFrames();
    }
    expect(selectedShapeIds().length).toBe(2);
    expect(shapeToolbarElement()).toBeNull();
  });
});

describe('the Shape tool over other objects (TC-28)', () => {
  it('TC-28: a drag that starts on a sticky note draws a shape and leaves the note where it was', async () => {
    await renderBoard();
    const note = createNote({ x: 0, y: 0 });
    const before = notePosition(note);

    await clickShapeTool();
    // The press lands on the note, and the note never hears about it.
    await dragOnSurfaceTo({ x: 100, y: 100 });

    const shapes = await waitForShapes(1);
    expect(shapes).toHaveLength(1);
    const after = notePosition(note);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('the same drag with Select up moves the note instead of drawing a shape', async () => {
    await renderBoard();
    const note = createNote({ x: 0, y: 0 });
    const before = notePosition(note);
    await dragNote(note, { x: 80, y: 60 });
    expect(notePosition(note).x).toBeCloseTo(before.x + 80, 6);
    expect(shapesInDoc()).toHaveLength(0);
  });

  it('the kind menu holds the three kinds in order and picks the one it is clicked for', async () => {
    await renderBoard();
    await clickShapeTool();
    const menu = document.querySelector('[data-testid="shape-kind-menu"]');
    expect(menu).not.toBeNull();
    const labels = Array.from(menu?.querySelectorAll('button') ?? []).map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(['Rectangle', 'Ellipse', 'Diamond']);

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="shape-kind-diamond"]')?.click();
    });
    await flushFrames();
    const id = await drawShape({ x: 400, y: 300 });
    expect(shapeInDoc(id).kind).toBe('diamond');
    expect(shapeElement(id).dataset.shapeKind).toBe('diamond');
  });

  it('a key picks the tool and Escape puts Select back without drawing anything', async () => {
    await renderBoard();
    await pressToolKey('s');
    expect(toolPressed('[data-testid="tool-shape"]')).toBe(true);
    await clickOnSurface(shapeToolSurface(), { x: 400, y: 300 });
    await waitForShapes(1);
    expect(toolPressed('[data-testid="tool-select"]')).toBe(true);

    await pressToolKey('s');
    pressKey('Escape');
    await flushFrames();
    expect(toolPressed('[data-testid="tool-select"]')).toBe(true);
    expect(shapesInDoc()).toHaveLength(1);
  });
});

async function dragOnSurfaceTo(to: { x: number; y: number }): Promise<void> {
  const surface = shapeToolSurface();
  await dragOnSurfaceCall(surface, { x: 640, y: 400 }, to);
}

async function dragOnSurfaceCall(surface: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  act(() => {
    surface.dispatchEvent(pointer('pointerdown', from));
  });
  act(() => {
    surface.dispatchEvent(pointer('pointermove', to));
  });
  await flushFrames();
  act(() => {
    surface.dispatchEvent(pointer('pointerup', to, true));
  });
  await flushFrames();
}

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  at: { x: number; y: number },
  up = false,
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: up ? 0 : 1,
  });
}
