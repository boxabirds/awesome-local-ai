import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { snapshot, type StrokeSnapshot } from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import { addNote, noteEl, press, renderBoardAtOrigin } from './board';
import { flushFrame } from './helpers';

const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });
const strokes = (doc: Y.Doc) => snapshot(doc).filter((o): o is StrokeSnapshot => o.type === 'stroke');
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const move = (x: number, y: number) => fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerId: 1 });
const up = (x: number, y: number) => fireEvent.pointerUp(window, { clientX: x, clientY: y, pointerId: 1 });

describe('pen tool', () => {
  it('P shows the pen toolbar with black and Medium selected', async () => {
    await renderBoardAtOrigin();
    expect(screen.queryByRole('toolbar', { name: 'Pen options' })).toBeNull();
    key('p');
    expect(pressed('Pen (P)')).toBe('true');
    expect(pressed('black pen')).toBe('true');
    expect(pressed('Medium')).toBe('true');
    expect(screen.getAllByRole('button', { name: /pen$/ }).filter((b) => b.getAttribute('aria-label') !== 'Pen (P)')).toHaveLength(6);
  });

  it('TC-09 a drag with red and Thick creates one stroke in that style and the pen stays active', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    key('p');
    fireEvent.click(screen.getByRole('button', { name: 'red pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));
    press(viewport, 100, 100);
    move(150, 140);
    await flushFrame();
    expect(screen.getByTestId('pen-preview').getAttribute('d')).toMatch(/^M100 100L/);
    expect(strokes(doc)).toHaveLength(0);
    move(200, 100);
    up(200, 100);
    const made = strokes(doc);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ color: 'red', thickness: 'thick' });
    expect(pressed('Pen (P)')).toBe('true');
    expect(screen.queryByTestId('pen-preview')).toBeNull();
  });

  it('TC-10 a click without moving makes a dot of the thickness', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    key('p');
    press(viewport, 300, 300);
    up(300, 300);
    const made = strokes(doc);
    expect(made).toHaveLength(1);
    expect(made[0].points).toHaveLength(2);
    expect(made[0].width).toBe(PEN_THICKNESS_WORLD.medium);
  });

  it('TC-11 pointercancel keeps the stroke drawn so far', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    key('p');
    press(viewport, 100, 100);
    move(160, 100);
    move(220, 150);
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(strokes(doc)).toHaveLength(1);
    expect(strokes(doc)[0].width).toBeGreaterThan(100);
  });

  it('a lost pointer capture finishes the stroke too, exactly once', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    key('p');
    press(viewport, 100, 100);
    move(200, 100);
    fireEvent.lostPointerCapture(viewport, { pointerId: 1 });
    up(200, 100);
    expect(strokes(doc)).toHaveLength(1);
  });

  it('TC-12 STROKE_MAX_POINTS + 10 moves make two strokes that join at the same point', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    key('p');
    press(viewport, 0, 0);
    const total = STROKE_MAX_POINTS + 10;
    // an arc, so simplification keeps real points on both parts
    const at = (i: number) => [20 + i * 0.1, 400 + 300 * Math.sin(i / 400)] as const;
    for (let i = 1; i <= total; i++) move(...at(i));
    up(...at(total));
    const made = strokes(doc);
    expect(made).toHaveLength(2);
    const [first, second] = made.sort((a, b) => a.z - b.z);
    const firstEnd = { x: first.x + first.points[first.points.length - 2], y: first.y + first.points[first.points.length - 1] };
    const secondStart = { x: second.x + second.points[0], y: second.y + second.points[1] };
    expect(secondStart.x).toBeCloseTo(firstEnd.x, 6);
    expect(secondStart.y).toBeCloseTo(firstEnd.y, 6);
  });

  it('TC-13 Escape leaves the pen without creating a stroke; V selects', async () => {
    const { doc } = await renderBoardAtOrigin();
    key('p');
    key('Escape');
    expect(pressed('Select (V)')).toBe('true');
    key('p');
    key('v');
    expect(pressed('Select (V)')).toBe('true');
    expect(strokes(doc)).toHaveLength(0);
    expect(screen.queryByRole('toolbar', { name: 'Pen options' })).toBeNull();
  });

  it('TC-14 changing the colour does not restyle an existing stroke; the next one uses it', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    key('p');
    press(viewport, 100, 100);
    move(200, 100);
    up(200, 100);
    fireEvent.click(screen.getByRole('button', { name: 'green pen' }));
    press(viewport, 100, 200);
    move(200, 200);
    up(200, 200);
    const made = strokes(doc).sort((a, b) => a.z - b.z);
    expect(made.map((s) => s.color)).toEqual(['black', 'green']);
    expect(PEN_COLORS.green).toBeTruthy();
  });

  it('a pen drag over a sticky note neither selects nor moves it', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    const id = addNote(doc, 300, 300);
    const before = snapshot(doc).find((o) => o.id === id);
    key('p');
    act(() => { fireEvent.pointerDown(noteEl(id), { clientX: 300, clientY: 300, button: 0, pointerId: 1 }); });
    move(400, 350);
    up(400, 350);
    expect(strokes(doc)).toHaveLength(1);
    expect(snapshot(doc).find((o) => o.id === id)).toMatchObject({ x: before!.x, y: before!.y });
    expect(noteEl(id).dataset.selected).not.toBe('true');
    expect(viewport.dataset.panState).toBe('idle');
  });
});
