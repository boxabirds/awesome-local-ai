import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, deleteObject, getStickyText, initDoc } from '../../src/shared/board-model';
import { renderApp, stickyNotes } from './helpers';

const REMOTE = Symbol('remote provider');

function setup(text: string) {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  if (id === false) throw new Error('create rejected');
  getStickyText(doc, id)?.insert(0, text);
  renderApp(doc);
  const ytext = getStickyText(doc, id)!;
  fireEvent.doubleClick(stickyNotes()[0]!);
  const editor = screen.getByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement;
  /** A change arriving from someone else (origin: the provider). */
  const remote = (fn: () => void) => act(() => doc.transact(fn, REMOTE));
  return { doc, id, ytext, editor, remote };
}

describe('sticky text editor with remote changes (live.concurrent_text)', () => {
  it("shows someone else's typing at once and keeps the caret with its characters", () => {
    const { ytext, editor, remote } = setup('green');
    editor.setSelectionRange(5, 5);
    remote(() => ytext.insert(0, 'red '));
    expect(editor.value).toBe('red green');
    expect(editor.selectionStart).toBe(9);
    // Remote text after the caret does not move it.
    remote(() => ytext.insert(9, ' blue'));
    expect(editor.value).toBe('red green blue');
    expect(editor.selectionStart).toBe(9);
    // Remote deletion before the caret shifts it back.
    remote(() => ytext.delete(0, 4));
    expect(editor.value).toBe('green blue');
    expect(editor.selectionStart).toBe(5);
  });

  it("typing after a remote change never removes the other person's text", () => {
    const { ytext, editor, remote } = setup('green');
    editor.setSelectionRange(5, 5);
    remote(() => ytext.insert(0, 'red '));
    // The browser inserts at the caret (after "green").
    const caret = editor.selectionStart;
    fireEvent.input(editor, { target: { value: `${editor.value.slice(0, caret)}!${editor.value.slice(caret)}` } });
    expect(ytext.toString()).toBe('red green!');
  });

  it('closes the editor without error when someone else deletes the note', () => {
    const { doc, id, remote } = setup('bye');
    remote(() => deleteObject(doc, id));
    expect(screen.queryByRole('textbox', { name: 'Sticky note text' })).toBeNull();
    expect(stickyNotes()).toHaveLength(0);
  });
});
