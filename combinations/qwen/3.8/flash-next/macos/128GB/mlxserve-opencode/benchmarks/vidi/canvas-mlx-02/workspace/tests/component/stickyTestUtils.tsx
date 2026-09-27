// Shared helpers for story 2 component tests (render App in jsdom).
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import App from '../../src/client/App.tsx';
import { STICKY_COLORS } from '../../src/shared/config.ts';

export interface AppHarness {
  view: RenderResult;
  viewport(): HTMLElement;
  worldLayer(): HTMLElement;
  cam(): { x: number; y: number; zoom: number };
  notes(): HTMLElement[];
  note(i: number): HTMLElement;
  editor(): HTMLElement | null;
}

export function renderBoard(): AppHarness {
  const view = render(<App />);

  const viewport = () => screen.getByTestId('viewport') as HTMLElement;
  const worldLayer = () => screen.getByTestId('world-layer') as HTMLElement;
  const cam = () => {
    const el = worldLayer();
    return {
      x: Number(el.getAttribute('data-cam-x')),
      y: Number(el.getAttribute('data-cam-y')),
      zoom: Number(el.getAttribute('data-cam-zoom')),
    };
  };
  const notes = () => screen.queryAllByRole('group', { name: 'Sticky note' });
  const note = (i: number) => notes()[i] as HTMLElement;
  const editor = () => screen.queryByTestId('sticky-editor');

  return { view, viewport, worldLayer, cam, notes, note, editor };
}

// Create a note via the toolbar button; returns once it is being edited.
export function createViaToolbar(_h: AppHarness): void {
  fireEvent.click(screen.getByTestId('sticky-create'));
}

// End editing (Escape) so the note is selected, not editing.
export function escape(h: AppHarness): void {
  const ed = h.editor();
  if (ed) fireEvent.keyDown(ed, { key: 'Escape' });
}

export function colorOf(el: HTMLElement): string {
  const s = el.style;
  const raw = s.background || s.backgroundColor || '';
  const hexm = /#([0-9a-fA-F]{6})/.exec(raw);
  if (hexm) return ('#' + hexm[1]).toUpperCase();
  const rgbm = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(raw);
  if (rgbm) {
    const to = (n: string) => Number(n).toString(16).padStart(2, '0').toUpperCase();
    return `#${to(rgbm[1])}${to(rgbm[2])}${to(rgbm[3])}`;
  }
  return raw.toUpperCase();
}

export const hex = (name: keyof typeof STICKY_COLORS): string => STICKY_COLORS[name].toUpperCase();

// Type into the editor (uncontrolled textarea): set value + fire input.
export function typeInto(h: AppHarness, value: string): void {
  const ed = h.editor();
  if (!ed) throw new Error('no editor to type into');
  (ed as HTMLTextAreaElement).value = value;
  fireEvent.input(ed, { target: { value } });
}

// Press a key that App listens for on window.
export function pressWindow(key: string): void {
  fireEvent.keyDown(window, { key });
}

// Select a note with a short press (no movement).
export function pressNote(h: AppHarness, i: number): void {
  const el = h.note(i);
  const r = { clientX: 500, clientY: 300 };
  fireEvent.pointerDown(el, { ...r, button: 0, pointerId: 1 });
  fireEvent.pointerUp(el, { ...r, pointerId: 1 });
}

// Click empty board space (a press with no movement on the viewport itself).
export function clickEmpty(h: AppHarness, x = 20, y = 20, pointerId = 7): void {
  const vp = h.viewport();
  fireEvent.pointerDown(vp, { clientX: x, clientY: y, button: 0, pointerId });
  fireEvent.pointerUp(vp, { clientX: x, clientY: y, pointerId });
}

// The note's world position, read back from its inline left/top (px == world units).
export function notePos(el: HTMLElement): { x: number; y: number } {
  const left = parseFloat(el.style.left);
  const top = parseFloat(el.style.top);
  return { x: left, y: top };
}

// Whether the note shows the blue selection outline.
export function hasOutline(el: HTMLElement): boolean {
  return /2563eb/i.test(el.style.outline || '');
}

export { fireEvent };

export { within };
