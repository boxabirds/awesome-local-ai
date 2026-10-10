import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import { collectStrokeSnapshots, scaledPoints } from '../../src/shared/objects/stroke';

const holder = vi.hoisted(() => ({ status: 'connected' as string }));
vi.mock('../../src/client/sync/ConnectionStatus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/ConnectionStatus')>();
  return { ...actual, useConnectionStatus: () => holder.status as never };
});

const { BoardView } = await import('../../src/client/pages/BoardPage');

let doc: Y.Doc;

function mount(): Y.Doc {
  doc = new Y.Doc();
  initDoc(doc);
  render(<BoardView doc={doc} />);
  return doc;
}

function penButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Pen (P)' });
}

function selectButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Select (V)' });
}

function overlay(): HTMLElement {
  return screen.getByTestId('pen-tool-overlay');
}

function down(x: number, y: number): void {
  fireEvent.pointerDown(overlay(), { clientX: x, clientY: y, pointerId: 1, button: 0 });
}

function moveTo(x: number, y: number): void {
  fireEvent.pointerMove(overlay(), { clientX: x, clientY: y, pointerId: 1 });
}

function up(x: number, y: number): void {
  fireEvent.pointerUp(overlay(), { clientX: x, clientY: y, pointerId: 1 });
}

function draw(points: Array<[number, number]>): void {
  down(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) moveTo(x, y);
  const last = points[points.length - 1];
  up(last[0], last[1]);
}

const zigzag: Array<[number, number]> = [
  [100, 100],
  [140, 120],
  [180, 100],
  [220, 140],
  [260, 90]
];

beforeEach(() => {
  vi.useFakeTimers();
  holder.status = 'connected';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pen.tool', () => {
  it('TC-09 drag with red + thick commits one stroke and the Pen stays active', () => {
    mount();
    fireEvent.keyDown(window, { key: 'p' });
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pen-toolbar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'red pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));

    down(100, 100);
    moveTo(140, 120);
    act(() => {
      vi.advanceTimersByTime(100); // frame: preview drawn
    });
    const preview = screen.getByTestId('pen-preview');
    expect(preview).toHaveAttribute('d', expect.stringContaining('M'));
    moveTo(180, 100);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId('pen-preview')).toHaveAttribute('d', expect.anything());
    up(260, 90);

    const strokes = collectStrokeSnapshots(doc);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].color).toBe('red');
    expect(strokes[0].thickness).toBe('thick');
    expect(screen.queryByTestId('pen-preview')).not.toBeInTheDocument();
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-10 a click with no movement commits a single-point stroke (dot)', () => {
    mount();
    fireEvent.keyDown(window, { key: 'p' });
    down(200, 200);
    up(201, 201);

    const strokes = collectStrokeSnapshots(doc);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].points).toHaveLength(2);
    const side = PEN_THICKNESS_WORLD.medium;
    expect(strokes[0].width).toBe(side);
    expect(strokes[0].height).toBe(side);
  });

  it('TC-11 pointercancel during a drag commits the points drawn so far', () => {
    mount();
    fireEvent.keyDown(window, { key: 'p' });
    down(100, 100);
    moveTo(160, 150);
    moveTo(220, 110);
    fireEvent.pointerCancel(overlay(), { pointerId: 1 });

    const strokes = collectStrokeSnapshots(doc);
    expect(strokes).toHaveLength(1);
    expect(scaledPoints(strokes[0]).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('pen-preview')).not.toBeInTheDocument();
  });

  it('TC-12 a drag reaching STROKE_MAX_POINTS commits a part and continues from its last point', () => {
    mount();
    fireEvent.keyDown(window, { key: 'p' });
    down(50, 50);
    for (let i = 1; i <= STROKE_MAX_POINTS + 10; i++) {
      moveTo(50 + i, 50 + i * 0.5);
    }
    up(50 + STROKE_MAX_POINTS + 10, 50 + (STROKE_MAX_POINTS + 10) * 0.5);

    const strokes = collectStrokeSnapshots(doc);
    expect(strokes).toHaveLength(2);
    const firstLine = scaledPoints(strokes[0]);
    const secondLine = scaledPoints(strokes[1]);
    const join = firstLine[firstLine.length - 1];
    expect(secondLine[0].x).toBeCloseTo(join.x, 6);
    expect(secondLine[0].y).toBeCloseTo(join.y, 6);
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-13 Escape mid-drag switches to Select and creates nothing; V keeps Select', () => {
    mount();
    fireEvent.keyDown(window, { key: 'p' });
    down(100, 100);
    moveTo(160, 160);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'v' });

    expect(penButton()).toHaveAttribute('aria-pressed', 'false');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('pen-tool-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pen-preview')).not.toBeInTheDocument();
    expect(collectStrokeSnapshots(doc)).toHaveLength(0);
  });

  it('TC-14 changing the colour affects the next stroke, never the existing one', () => {
    mount();
    fireEvent.keyDown(window, { key: 'p' });
    draw(zigzag);
    expect(collectStrokeSnapshots(doc)).toHaveLength(1);
    expect(collectStrokeSnapshots(doc)[0].color).toBe('black');

    fireEvent.click(screen.getByRole('button', { name: 'green pen' }));
    expect(screen.getByRole('button', { name: 'green pen' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'black pen' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    draw([
      [300, 100],
      [340, 160],
      [380, 110]
    ]);

    const strokes = collectStrokeSnapshots(doc);
    expect(strokes).toHaveLength(2);
    expect(strokes[0].color).toBe('black');
    expect(strokes[1].color).toBe('green');
  });

  it('pen toolbar is hidden for Select and shown only for Pen', () => {
    mount();
    expect(screen.queryByTestId('pen-toolbar')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'p' });
    expect(screen.getByTestId('pen-toolbar')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('pen-toolbar')).not.toBeInTheDocument();
  });
});
