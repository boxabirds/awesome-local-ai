import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { newDoc } from './helpers';

const hoisted = vi.hoisted(() => ({ doc: null as unknown as Y.Doc, connection: 'connected' as string }));

vi.mock('../../src/client/board/useBoardDoc', async () => {
  const model = await import('../../src/shared/board-model');
  const react = await import('react');
  return {
    useBoardDoc: () => {
      const doc = hoisted.doc;
      const [objects, setObjects] = react.useState(() => model.snapshotObjects(doc));
      react.useEffect(() => {
        const map = doc.getMap('objects');
        const h = () => setObjects(model.snapshotObjects(doc));
        map.observeDeep(h);
        return () => map.unobserveDeep(h);
      }, [doc]);
      return { doc, objects, connection: hoisted.connection };
    },
  };
});

import { snapshotObjects, type StickySnapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { TextSnapshot } from '../../src/shared/objects/text';
import { App } from './TestApp';

afterEach(cleanup);
beforeEach(() => {
  hoisted.doc = newDoc();
  hoisted.connection = 'connected';
});

const textButton = () => screen.getByRole('button', { name: 'Text (T)' }) as HTMLButtonElement;
const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const pressed = (b: HTMLElement) => b.getAttribute('aria-pressed');

describe('tool mode', () => {
  it('TC-14 T activates Text, Escape and V return to Select', () => {
    render(<App />);
    expect(pressed(selectButton())).toBe('true');
    expect(pressed(textButton())).toBe('false');
    fireEvent.keyDown(window, { key: 't' });
    expect(pressed(textButton())).toBe('true');
    expect(pressed(selectButton())).toBe('false');
    expect(screen.getByTestId('board-viewport').style.cursor).toBe('text');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(pressed(selectButton())).toBe('true');
    fireEvent.keyDown(window, { key: 't' });
    fireEvent.keyDown(window, { key: 'v' });
    expect(pressed(selectButton())).toBe('true');
    expect(snapshotObjects(hoisted.doc)).toHaveLength(0);
    fireEvent.click(textButton());
    expect(pressed(textButton())).toBe('true');
    fireEvent.click(selectButton());
    expect(pressed(selectButton())).toBe('true');
  });

  it('TC-15 load failed: Text button disabled and T ignored', () => {
    hoisted.connection = 'load_failed';
    render(<App />);
    expect(textButton().disabled).toBe(true);
    fireEvent.keyDown(window, { key: 't' });
    expect(pressed(textButton())).toBe('false');
    fireEvent.click(screen.getByTestId('board-viewport'));
    expect(snapshotObjects(hoisted.doc)).toHaveLength(0);
  });

  it('active Text tool reverts to Select when the board stops being editable', () => {
    const { rerender } = render(<App />);
    fireEvent.keyDown(window, { key: 't' });
    expect(pressed(textButton())).toBe('true');
    hoisted.connection = 'load_failed';
    rerender(<App />);
    expect(pressed(selectButton())).toBe('true');
  });

  it('TC-16 T while editing a note types a character and keeps the tool', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    const user = userEvent.setup();
    await user.keyboard('t');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('t');
    expect(pressed(selectButton())).toBe('true');
    expect(pressed(textButton())).toBe('false');
  });

  it('TC-17 Text tool click creates text at the world point, returns to Select and starts editing', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 't' });
    fireEvent.click(screen.getByTestId('board-viewport'), { clientX: 300, clientY: 200 });
    const all = snapshotObjects(hoisted.doc);
    expect(all).toHaveLength(1);
    const t = all[0] as TextSnapshot;
    // The initial camera centres the world origin on screen (jsdom viewport 1024 x 768).
    expect(t.type).toBe('text');
    expect(t.x).toBe(300 - window.innerWidth / 2);
    expect(t.y).toBe(200 - window.innerHeight / 2);
    expect(t.size).toBe('M');
    expect(pressed(selectButton())).toBe('true');
    const editor = screen.getByRole('textbox', { name: 'Text' });
    expect(document.activeElement).toBe(editor);
    // A second click now does not create more text.
    fireEvent.click(screen.getByTestId('board-viewport'), { clientX: 400, clientY: 300 });
    expect(snapshotObjects(hoisted.doc)).toHaveLength(1);
  });

  it('Text tool click on top of an object still creates text there', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    fireEvent.keyDown(window, { key: 't' });
    const note = screen.getByRole('group', { name: 'Sticky note' });
    fireEvent.pointerDown(note, { clientX: 512, clientY: 384, pointerId: 1 });
    fireEvent.click(note, { clientX: 512, clientY: 384 });
    expect(snapshotObjects(hoisted.doc).filter((o) => o.type === 'text')).toHaveLength(1);
  });

  it('TC-18 N creates a sticky at the view centre', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'n' });
    const s = snapshotObjects(hoisted.doc)[0] as StickySnapshot;
    expect(s.type).toBe('sticky');
    expect(s.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(s.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('N does nothing when the board cannot be edited', () => {
    hoisted.connection = 'load_failed';
    render(<App />);
    act(() => { fireEvent.keyDown(window, { key: 'n' }); });
    expect(snapshotObjects(hoisted.doc)).toHaveLength(0);
  });
});
