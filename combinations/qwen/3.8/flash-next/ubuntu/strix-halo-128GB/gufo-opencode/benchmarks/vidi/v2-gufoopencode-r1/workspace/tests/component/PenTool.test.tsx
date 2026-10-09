import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef, useState, type JSX, type MutableRefObject } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import { initDoc, snapshotAll, type ObjectSnapshot } from '../../src/shared/board-model';
import { scaledPoints, type StrokeSnapshot } from '../../src/shared/objects/stroke';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';

interface Reg {
  doc: Y.Doc;
  selection: SelectionApi;
}
let registry: MutableRefObject<Reg | null> = { current: null };

function Harness(props: { canEdit?: boolean }): JSX.Element {
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
  registry.current = { doc, selection };
  return <BoardViewport doc={doc} notes={notes} selection={selection} editable={props.canEdit !== false} />;
}

const ctrl = (): Reg => registry.current!;
const strokes = (): StrokeSnapshot[] => snapshotAll(ctrl().doc).filter((obj) => obj.type === 'stroke') as StrokeSnapshot[];
const press = (key: string): void => {
  fireEvent.keyDown(window, { key });
};
const toolButton = (name: string): HTMLButtonElement => screen.getByRole('button', { name }) as HTMLButtonElement;
const pressed = (b: HTMLButtonElement): boolean => b.getAttribute('aria-pressed') === 'true';

const overlay = (): HTMLElement => screen.getByTestId('pen-tool-overlay');

function dragPen(points: [number, number][]): void {
  const el = overlay();
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: points[0][0], clientY: points[0][1] });
  for (let i = 1; i < points.length; i += 1) {
    fireEvent.pointerMove(el, { pointerId: 1, clientX: points[i][0], clientY: points[i][1] });
  }
  const last = points[points.length - 1];
  fireEvent.pointerUp(el, { pointerId: 1, clientX: last[0], clientY: last[1] });
}

const zigzag: [number, number][] = [
  [100, 100],
  [160, 140],
  [220, 100],
  [280, 160]
];

beforeEach(() => {
  registry = { current: null };
});
afterEach(() => {
  cleanup();
});

describe('pen.tool component (story 11)', () => {
  test('TC-09 drawing with red + thick commits one stroke and keeps the Pen armed', () => {
    render(<Harness />);
    press('p');
    expect(pressed(toolButton('Pen (P)'))).toBe(true);
    expect(screen.getByTestId('pen-toolbar')).not.toBeNull();
    fireEvent.click(screen.getByTestId('pen-color-red'));
    fireEvent.click(screen.getByTestId('pen-thickness-thick'));
    expect(pressed(toolButton('Red pen'))).toBe(true);
    expect(pressed(toolButton('Thick'))).toBe(true);

    dragPen(zigzag);
    const drawn = strokes();
    expect(drawn.length).toBe(1);
    expect(drawn[0].color).toBe('red');
    expect(drawn[0].thickness).toBe('thick');
    expect(drawn[0].points.length).toBeGreaterThanOrEqual(2);
    expect(pressed(toolButton('Pen (P)'))).toBe(true);
  });

  test('TC-09b the preview path is shown while dragging and gone after release', () => {
    render(<Harness />);
    press('p');
    const el = overlay();
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 120, clientY: 120 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 240, clientY: 180 });
    const preview = screen.getByTestId('pen-preview-path');
    expect(preview.getAttribute('d')).toMatch(/^M/);
    expect(preview.getAttribute('stroke')).toBe(PEN_COLORS.black);
    expect(preview.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium));
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 240, clientY: 180 });
    expect(screen.queryByTestId('pen-preview')).toBeNull();
  });

  test('TC-10 a click without movement commits a single-point dot stroke', () => {
    render(<Harness />);
    press('p');
    const el = overlay();
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 300, clientY: 250 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 300, clientY: 250 });
    const drawn = strokes();
    expect(drawn.length).toBe(1);
    expect(drawn[0].points.length).toBe(2);
    // Default medium (4 world units): bbox is a thickness square centred on the press.
    expect(drawn[0].width).toBeCloseTo(4, 6);
    expect(drawn[0].height).toBeCloseTo(4, 6);
    const [center] = scaledPoints(drawn[0]);
    expect(center.x).toBeCloseTo(300 - window.innerWidth / 2, 6);
    expect(center.y).toBeCloseTo(250 - window.innerHeight / 2, 6);
  });

  test('TC-11 a cancelled pointer commits the points drawn so far', () => {
    render(<Harness />);
    press('p');
    const el = overlay();
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 180, clientY: 160 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 260, clientY: 110 });
    fireEvent.pointerCancel(el, { pointerId: 1, clientX: 260, clientY: 110 });
    expect(strokes().length).toBe(1);
    // A trailing pointerup after the cancel must not commit a second stroke.
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 260, clientY: 110 });
    expect(strokes().length).toBe(1);
  });

  test('TC-12 exceeding STROKE_MAX_POINTS splits into two chained strokes', () => {
    render(<Harness />);
    press('p');
    const el = overlay();
    const move = (i: number): [number, number] => [100 + i * 0.05, 100 + Math.sin(i / 7) * 40];
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    for (let i = 1; i <= STROKE_MAX_POINTS + 10; i += 1) {
      const [x, y] = move(i);
      fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y });
    }
    const [lastX, lastY] = move(STROKE_MAX_POINTS + 10);
    fireEvent.pointerUp(el, { pointerId: 1, clientX: lastX, clientY: lastY });
    const drawn = strokes();
    expect(drawn.length).toBe(2);
    const first = scaledPoints(drawn[0]);
    const second = scaledPoints(drawn[1]);
    const join = first[first.length - 1];
    expect(second[0].x).toBeCloseTo(join.x, 6);
    expect(second[0].y).toBeCloseTo(join.y, 6);
  });

  test('TC-13 Escape mid-stroke switches to Select without creating anything', () => {
    render(<Harness />);
    press('p');
    const el = overlay();
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 200, clientY: 160 });
    press('Escape');
    expect(pressed(toolButton('Select (V)'))).toBe(true);
    expect(screen.queryByTestId('pen-tool-overlay')).toBeNull();
    expect(strokes().length).toBe(0);
    press('v');
    expect(pressed(toolButton('Select (V)'))).toBe(true);
    expect(strokes().length).toBe(0);
  });

  test('TC-14 changing the colour never restyles existing strokes', () => {
    render(<Harness />);
    press('p');
    dragPen(zigzag);
    fireEvent.click(screen.getByTestId('pen-color-red'));
    dragPen([
      [150, 300],
      [250, 360],
      [350, 300]
    ]);
    const drawn = strokes();
    expect(drawn.length).toBe(2);
    expect(drawn[0].color).toBe('black');
    expect(drawn[1].color).toBe('red');
  });

  test('TC-14b changing the thickness only applies to the next stroke', () => {
    render(<Harness />);
    press('p');
    dragPen(zigzag);
    const before = strokes()[0];
    fireEvent.click(screen.getByTestId('pen-thickness-thick'));
    dragPen(zigzag.map(([x, y]) => [x + 40, y + 60] as [number, number]));
    const drawn = strokes();
    expect(drawn.length).toBe(2);
    expect(drawn[0].thickness).toBe('medium');
    expect(drawn[1].thickness).toBe('thick');
    expect(drawn[0]).toEqual(before);
  });
});
