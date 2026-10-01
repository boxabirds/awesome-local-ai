import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

const hook: { setState?: (s: ConnectionState) => void } = {};

vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _id: string, onState: (s: ConnectionState) => void) => {
    hook.setState = onState;
    onState('connecting');
    return { destroy() {} };
  },
}));

const { App } = await import('../../src/client/App');
const { setDefaultMeasurer } = await import('../../src/client/objects/textLayout');
const { notes, viewport } = await import('./helpers');

beforeEach(() => setDefaultMeasurer((t) => t.length * 10));
afterEach(() => {
  cleanup();
  setDefaultMeasurer(null);
});

const textButton = () => screen.getByRole('button', { name: 'Text (T)' });
const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const key = (k: string, target: Window | Element = window) => fireEvent.keyDown(target, { key: k });
const textObjects = () => document.querySelectorAll<HTMLElement>('[data-text-object]');

describe('tool mode', () => {
  it('TC-14 T activates Text, Escape and V return to Select', () => {
    render(<App />);
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    key('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('true');
    expect(selectButton().getAttribute('aria-pressed')).toBe('false');
    expect(viewport().style.cursor).toBe('text');
    key('Escape');
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    key('t');
    key('v');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(textButton());
    expect(textButton().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(selectButton());
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
    expect(textObjects()).toHaveLength(0);
  });

  it('TC-15 on a board that failed to load T is ignored and the button is disabled', () => {
    render(<App boardId="b-1" />);
    act(() => hook.setState?.('load_failed'));
    expect((textButton() as HTMLButtonElement).disabled).toBe(true);
    key('t');
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-16 T while editing a note types the letter and leaves the tool alone', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    key('t', box);
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-17 with Text active a board click creates text at that point, back to Select, editing', () => {
    render(<App />);
    key('t');
    fireEvent.pointerDown(viewport(), { clientX: 300, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport(), { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.click(viewport(), { clientX: 300, clientY: 200 });
    expect(textObjects()).toHaveLength(1);
    const t = textObjects()[0];
    expect(parseFloat(t.style.left)).toBe(300 - window.innerWidth / 2);
    expect(parseFloat(t.style.top)).toBe(200 - window.innerHeight / 2);
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('a click alone (no pointer events) also places text, and a second click does not add another', () => {
    render(<App />);
    key('t');
    fireEvent.click(viewport(), { clientX: 100, clientY: 100 });
    expect(textObjects()).toHaveLength(1);
    fireEvent.click(viewport(), { clientX: 400, clientY: 100 });
    expect(textObjects()).toHaveLength(1);
  });

  it('text can be placed on top of an existing note', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    key('t');
    fireEvent.pointerDown(notes()[0], { clientX: 520, clientY: 390, pointerId: 1, button: 0 });
    expect(textObjects()).toHaveLength(1);
    expect(notes()).toHaveLength(1);
  });

  it('TC-18 N still creates a sticky note at the view centre', () => {
    render(<App />);
    key('n');
    expect(notes()).toHaveLength(1);
    expect(notes()[0].style.left).toBe('-100px');
    expect(notes()[0].style.top).toBe('-100px');
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });
});
