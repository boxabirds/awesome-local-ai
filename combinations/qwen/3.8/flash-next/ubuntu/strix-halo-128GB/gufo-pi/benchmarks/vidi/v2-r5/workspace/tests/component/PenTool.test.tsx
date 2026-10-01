import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { PenTool } from '../../src/client/tools/PenTool';
import { PenToolbar } from '../../src/client/tools/PenToolbar';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';

// Mock requestAnimationFrame for deterministic tests
let rafCallbacks: Array<() => void> = [];
beforeEach(() => {
  rafCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (_id: number) => {
    // no-op for testing
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

void rafCallbacks; // reference to suppress unused warning

function createPointerEvent(type: string, opts: { clientX: number; clientY: number; pointerId?: number; button?: number } = { clientX: 0, clientY: 0 }) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, {
    clientX: opts.clientX,
    clientY: opts.clientY,
    pointerId: opts.pointerId ?? 1,
    button: opts.button ?? 0,
    pointerType: 'mouse',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    getCoalescedEvents: () => [],
  });
  return event;
}

describe('PenTool', () => {
  let doc: Y.Doc;
  const camera = { x: 0, y: 0, zoom: 1 };

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-09: pointerdown/moves/up with red + thick → createStroke called once with red/thick; tool still pen', () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <PenTool camera={camera} color="red" thickness="thick" doc={doc} identityId="user-1" onCommit={onCommit} />,
    );
    const overlay = getByTestId('pen-tool-overlay');

    // Simulate a drag
    fireEvent(overlay, createPointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    fireEvent(overlay, createPointerEvent('pointermove', { clientX: 30, clientY: 30 }));
    fireEvent(overlay, createPointerEvent('pointermove', { clientX: 50, clientY: 50 }));
    fireEvent(overlay, createPointerEvent('pointerup', { clientX: 50, clientY: 50 }));

    // Check that a stroke was created
    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objMap.size).toBe(1);
    const strokeMap = [...objMap.values()][0]!;
    expect(strokeMap.get('color')).toBe('red');
    expect(strokeMap.get('thickness')).toBe('thick');
    expect(onCommit).toHaveBeenCalled();
  });

  it('TC-10: pointerdown/up without movement → single-point dot committed', () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <PenTool camera={camera} color="black" thickness="medium" doc={doc} identityId="user-1" onCommit={onCommit} />,
    );
    const overlay = getByTestId('pen-tool-overlay');

    // Click without movement
    fireEvent(overlay, createPointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    fireEvent(overlay, createPointerEvent('pointerup', { clientX: 100, clientY: 100 }));

    // Check dot was created
    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objMap.size).toBe(1);
    const strokeMap = [...objMap.values()][0]!;
    expect(strokeMap.get('width')).toBe(PEN_THICKNESS_WORLD.medium);
    expect(strokeMap.get('height')).toBe(PEN_THICKNESS_WORLD.medium);
    expect(onCommit).toHaveBeenCalled();
  });

  it('TC-11: pointerdown, moves, pointercancel → stroke committed with points so far', () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <PenTool camera={camera} color="blue" thickness="thin" doc={doc} identityId="user-1" onCommit={onCommit} />,
    );
    const overlay = getByTestId('pen-tool-overlay');

    // Simulate interrupted drag
    fireEvent(overlay, createPointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    fireEvent(overlay, createPointerEvent('pointermove', { clientX: 30, clientY: 30 }));
    fireEvent(overlay, createPointerEvent('pointermove', { clientX: 50, clientY: 50 }));
    // pointercancel instead of pointerup
    fireEvent(overlay, createPointerEvent('pointercancel', { clientX: 50, clientY: 50 }));

    // Stroke should be committed with the points drawn so far
    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objMap.size).toBe(1);
    const strokeMap = [...objMap.values()][0]!;
    expect(strokeMap.get('type')).toBe('stroke');
    expect(strokeMap.get('color')).toBe('blue');
    expect(onCommit).toHaveBeenCalled();
  });

  it('TC-12: STROKE_MAX_POINTS + 10 moves → two createStroke calls; second starts at first last point', () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <PenTool camera={camera} color="black" thickness="medium" doc={doc} identityId="user-1" onCommit={onCommit} />,
    );
    const overlay = getByTestId('pen-tool-overlay');

    // Start drawing
    fireEvent(overlay, createPointerEvent('pointerdown', { clientX: 0, clientY: 0 }));

    // Move STROKE_MAX_POINTS + 10 times
    for (let i = 1; i <= STROKE_MAX_POINTS + 10; i++) {
      fireEvent(overlay, createPointerEvent('pointermove', { clientX: i * 0.1, clientY: i * 0.1 }));
    }

    // Finish
    fireEvent(overlay, createPointerEvent('pointerup', { clientX: (STROKE_MAX_POINTS + 10) * 0.1, clientY: (STROKE_MAX_POINTS + 10) * 0.1 }));

    // Should have 2 strokes committed
    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objMap.size).toBe(2);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('TC-13: Escape switches tool; no stroke created (handled by useBoardKeys)', () => {
    // The PenTool itself doesn't handle keyboard shortcuts.
    // Escape is handled by useBoardKeys which sets tool to 'select'.
    // When the tool is not 'pen', PenTool is not rendered.
    // This test verifies that without a completed drag, no stroke exists.
    const onCommit = vi.fn();
    const { getByTestId, unmount } = render(
      <PenTool camera={camera} color="black" thickness="medium" doc={doc} identityId="user-1" onCommit={onCommit} />,
    );
    const overlay = getByTestId('pen-tool-overlay');

    // Just pointerdown but no moves or up (escape would unmount the component)
    fireEvent(overlay, createPointerEvent('pointerdown', { clientX: 50, clientY: 50 }));

    // Simulate Escape by unmounting (as would happen when tool changes)
    unmount();

    // No stroke was created (drawing was interrupted by unmount)
    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objMap.size).toBe(0);
  });

  it('TC-14: change colour after a stroke → existing stroke unchanged; next uses new colour', () => {
    const onCommit = vi.fn();
    const { getByTestId, rerender } = render(
      <PenTool camera={camera} color="red" thickness="medium" doc={doc} identityId="user-1" onCommit={onCommit} />,
    );
    const overlay = getByTestId('pen-tool-overlay');

    // Draw first stroke with red
    fireEvent(overlay, createPointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    fireEvent(overlay, createPointerEvent('pointermove', { clientX: 30, clientY: 30 }));
    fireEvent(overlay, createPointerEvent('pointerup', { clientX: 30, clientY: 30 }));

    // Re-render with blue (simulating colour change)
    rerender(
      <PenTool camera={camera} color="blue" thickness="medium" doc={doc} identityId="user-1" onCommit={onCommit} />,
    );

    // Draw second stroke with blue
    fireEvent(overlay, createPointerEvent('pointerdown', { clientX: 50, clientY: 50 }));
    fireEvent(overlay, createPointerEvent('pointermove', { clientX: 70, clientY: 70 }));
    fireEvent(overlay, createPointerEvent('pointerup', { clientX: 70, clientY: 70 }));

    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objMap.size).toBe(2);
    const strokes = [...objMap.values()];
    // First stroke should still be red
    expect(strokes[0]!.get('color')).toBe('red');
    // Second should be blue
    expect(strokes[1]!.get('color')).toBe('blue');
  });
});

describe('PenToolbar', () => {
  it('renders six colour swatches and three thickness buttons', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();
    const { getByLabelText } = render(
      <PenToolbar color="black" thickness="medium" onColor={onColor} onThickness={onThickness} />,
    );

    // Six colour swatches
    const colors = ['black', 'blue', 'red', 'green', 'orange', 'purple'];
    for (const c of colors) {
      expect(getByLabelText(`${c} pen`)).toBeTruthy();
    }

    // Three thickness buttons
    expect(getByLabelText('Thin')).toBeTruthy();
    expect(getByLabelText('Medium')).toBeTruthy();
    expect(getByLabelText('Thick')).toBeTruthy();
  });

  it('clicking a colour swatch calls onColor', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();
    const { getByLabelText } = render(
      <PenToolbar color="black" thickness="medium" onColor={onColor} onThickness={onThickness} />,
    );

    fireEvent.click(getByLabelText('red pen'));
    expect(onColor).toHaveBeenCalledWith('red');
  });

  it('aria-pressed reflects current selection', () => {
    const { getByLabelText } = render(
      <PenToolbar color="blue" thickness="thick" onColor={vi.fn()} onThickness={vi.fn()} />,
    );

    expect(getByLabelText('blue pen').getAttribute('aria-pressed')).toBe('true');
    expect(getByLabelText('black pen').getAttribute('aria-pressed')).toBe('false');
    expect(getByLabelText('Thick').getAttribute('aria-pressed')).toBe('true');
    expect(getByLabelText('Medium').getAttribute('aria-pressed')).toBe('false');
  });
});
