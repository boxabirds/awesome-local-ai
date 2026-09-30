/**
 * Story 11: pen.tool component tests (TC-09 to TC-14).
 *
 * jsdom + real Y.Doc + synthetic pointer events. `createStroke` is mocked
 * so the tests assert the committed points/colour/thickness and the tool
 * state machine (stay active, dot, interrupted, long-stroke split).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { dispatchPointer } from '../helpers';
import { STROKE_MAX_POINTS } from '@shared/config';

const { createStrokeMock, connectMock } = vi.hoisted(() => {
  const createStrokeMock = vi.fn(
    (_doc: Y.Doc, _a: { points: readonly { x: number; y: number }[]; color: string; thickness: string }, _by: string) => 'stroke-id',
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectMock = vi.fn((..._args: any[]) => ({ destroy: () => {} }));
  return { createStrokeMock, connectMock };
});
vi.mock('@shared/objects/stroke', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/objects/stroke')>();
  return { ...actual, createStroke: createStrokeMock };
});
vi.mock('@client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@client/sync/connectBoard')>();
  return { ...actual, connectBoard: connectMock as () => { destroy(): void } };
});

const { Board } = await import('@client/Board');

const capturedDocs: Y.Doc[] = [];

function renderBoard(boardId = 'pen-test') {
  return render(<Board boardId={boardId} />);
}

function activatePen() {
  fireEvent.click(screen.getByLabelText('Pen (P)'));
  expect(screen.getByLabelText('Pen (P)')).toHaveAttribute('aria-pressed', 'true');
  return screen.getByTestId('pen-tool-overlay');
}

function lastCallPoints(): Array<{ x: number; y: number }> {
  const calls = createStrokeMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1].points as Array<{ x: number; y: number }>;
}

describe('pen.tool (ui-component)', () => {
  beforeEach(() => {
    capturedDocs.length = 0;
    createStrokeMock.mockClear();
    createStrokeMock.mockReturnValue('stroke-id');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (connectMock as any).mockImplementation((doc: Y.Doc, _id: string, onState: (s: string) => void) => {
      capturedDocs.push(doc);
      onState('connected');
      return { destroy: () => {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  // TC-09: drag with red + thick → one stroke in red/thick; tool stays pen.
  it('TC-09: pointerdown/moves/up with red + thick commits one red/thick stroke and stays pen', () => {
    renderBoard();
    const overlay = activatePen();

    // Pick red and thick on the pen toolbar.
    fireEvent.click(screen.getByLabelText('red pen'));
    expect(screen.getByLabelText('red pen')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByLabelText('Thick'));
    expect(screen.getByLabelText('Thick')).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      dispatchPointer(overlay, 'pointerdown', 100, 100);
    });
    act(() => {
      dispatchPointer(overlay, 'pointermove', 150, 130);
    });
    act(() => {
      dispatchPointer(overlay, 'pointermove', 200, 120);
    });
    act(() => {
      dispatchPointer(overlay, 'pointerup', 200, 120);
    });

    expect(createStrokeMock).toHaveBeenCalledTimes(1);
    const a = createStrokeMock.mock.calls[0][1] as { points: readonly { x: number; y: number }[]; color: string; thickness: string };
    expect(a.color).toBe('red');
    expect(a.thickness).toBe('thick');
    expect(a.points.length).toBeGreaterThanOrEqual(3);

    // The pen stays active after a finished stroke (PRD pen.stay_active).
    expect(screen.getByLabelText('Pen (P)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pen-tool-overlay')).toBeTruthy();
  });

  // TC-10: click without movement → single-point dot.
  it('TC-10: pointerdown/up without movement commits a single-point dot', () => {
    renderBoard();
    const overlay = activatePen();

    act(() => {
      dispatchPointer(overlay, 'pointerdown', 100, 100);
      dispatchPointer(overlay, 'pointerup', 100, 100);
    });

    expect(createStrokeMock).toHaveBeenCalledTimes(1);
    const pts = lastCallPoints();
    expect(pts).toHaveLength(1);
  });

  // TC-11: interrupted drag (pointercancel) → stroke committed with the
  // points so far, not discarded (PRD pen.interrupted).
  it('TC-11: pointercancel commits the stroke with the points so far', () => {
    renderBoard();
    const overlay = activatePen();

    act(() => {
      dispatchPointer(overlay, 'pointerdown', 100, 100);
      dispatchPointer(overlay, 'pointermove', 150, 130);
      dispatchPointer(overlay, 'pointermove', 200, 120);
    });
    act(() => {
      dispatchPointer(overlay, 'pointercancel', 200, 120);
    });

    expect(createStrokeMock).toHaveBeenCalledTimes(1);
    const pts = lastCallPoints();
    expect(pts.length).toBeGreaterThanOrEqual(3);
  });

  // TC-12: STROKE_MAX_POINTS + 10 moves → two commits; the second part
  // starts at the first part's last point (boundary).
  it('TC-12: a long drag splits into two strokes joining at the same point', () => {
    renderBoard();
    const overlay = activatePen();

    act(() => {
      dispatchPointer(overlay, 'pointerdown', 100, 100);
      for (let i = 1; i <= STROKE_MAX_POINTS + 10; i++) {
        dispatchPointer(overlay, 'pointermove', 100 + i * 0.5, 100);
      }
      dispatchPointer(overlay, 'pointerup', 100 + (STROKE_MAX_POINTS + 10) * 0.5, 100);
    });

    expect(createStrokeMock).toHaveBeenCalledTimes(2);
    const first = createStrokeMock.mock.calls[0][1].points as Array<{ x: number; y: number }>;
    const second = createStrokeMock.mock.calls[1][1].points as Array<{ x: number; y: number }>;
    // Part 1 is the full limit (simplified, first/last kept).
    expect(first.length).toBeGreaterThanOrEqual(2);
    // Part 2 starts at part 1's last point (no visible gap).
    expect(second[0]).toEqual(first[first.length - 1]);
  });

  // TC-13 (negative): Escape and V switch tools; nothing is created.
  it('TC-13: Escape then V switches to select and creates no stroke', () => {
    renderBoard();
    const overlay = activatePen();

    // A press that ends in Escape must not create anything.
    act(() => {
      dispatchPointer(overlay, 'pointerdown', 100, 100);
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    // Escape deactivated the pen (the overlay unmounted mid-gesture).
    expect(screen.getByLabelText('Pen (P)')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('pen-tool-overlay')).toBeNull();

    act(() => {
      fireEvent.keyDown(window, { key: 'v' });
    });
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');

    expect(createStrokeMock).not.toHaveBeenCalled();
  });

  // TC-14 (negative): changing options after a stroke exists does not
  // restyle existing strokes; the next stroke uses the new colour.
  it('TC-14: changing colour restyles no existing stroke; next stroke uses it', () => {
    renderBoard();
    const doc = capturedDocs[0];
    const overlay = activatePen();

    // A pre-existing stroke (blue) in the doc.
    act(() => {
      const obj = new Y.Map();
      obj.set('type', 'stroke');
      obj.set('x', 0);
      obj.set('y', 0);
      obj.set('width', 50);
      obj.set('height', 50);
      obj.set('points', [10, 10, 40, 40]);
      obj.set('baseWidth', 50);
      obj.set('baseHeight', 50);
      obj.set('color', 'blue');
      obj.set('thickness', 'medium');
      obj.set('z', 1);
      obj.set('createdAt', Date.now());
      doc.getMap('objects').set('existing-stroke', obj);
    });

    // Draw a stroke with the defaults (black).
    act(() => {
      dispatchPointer(overlay, 'pointerdown', 100, 100);
      dispatchPointer(overlay, 'pointermove', 150, 120);
      dispatchPointer(overlay, 'pointerup', 150, 120);
    });
    expect(createStrokeMock).toHaveBeenCalledTimes(1);
    expect((createStrokeMock.mock.calls[0][1] as { color: string }).color).toBe('black');

    // Change colour, then draw again.
    fireEvent.click(screen.getByLabelText('red pen'));
    act(() => {
      dispatchPointer(overlay, 'pointerdown', 200, 200);
      dispatchPointer(overlay, 'pointermove', 250, 220);
      dispatchPointer(overlay, 'pointerup', 250, 220);
    });
    expect(createStrokeMock).toHaveBeenCalledTimes(2);
    expect((createStrokeMock.mock.calls[1][1] as { color: string }).color).toBe('red');

    // The existing stroke in the doc is untouched.
    const existing = doc.getMap('objects').get('existing-stroke') as Y.Map<unknown>;
    expect(existing.get('color')).toBe('blue');
    expect(existing.get('thickness')).toBe('medium');
  });
});
