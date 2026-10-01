import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { snapshot } from '../../src/shared/board-model';
import { OVER_LIMIT_TEXT } from '../fixtures/texts';
import { Harness, addNote, newProbe, notes, press, release } from './helpers';

afterEach(cleanup);

function setup(text = '') {
  const probe = newProbe();
  render(<Harness probe={probe} />);
  addNote(probe, text);
  return probe;
}

const textbox = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const text = (probe: ReturnType<typeof newProbe>) => snapshot(probe.doc)[0].text;

describe('StickyTextEditor', () => {
  it('TC-23 Enter on a selected note edits with the caret at the end', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    fireEvent.input(textbox(), { target: { value: 'hello' } });
    fireEvent.keyDown(textbox(), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.keyDown(notes()[0], { key: 'Enter' });
    const box = textbox();
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe('hello');
    expect(box.selectionStart).toBe(5);
    expect(box.selectionEnd).toBe(5);
  });

  it('TC-24 Escape ends editing, keeps text and selection', () => {
    const probe = setup('abc');
    fireEvent.doubleClick(notes()[0]);
    fireEvent.input(textbox(), { target: { value: 'abcd' } });
    fireEvent.keyDown(textbox(), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(text(probe)).toBe('abcd');
    expect(probe.selectedId).not.toBeNull();
    expect(probe.editingId).toBeNull();
  });

  it('TC-26 Backspace while editing does not delete the note', () => {
    const probe = setup('ab');
    fireEvent.doubleClick(notes()[0]);
    fireEvent.keyDown(textbox(), { key: 'Backspace' });
    fireEvent.input(textbox(), { target: { value: 'a' } });
    expect(notes()).toHaveLength(1);
    expect(text(probe)).toBe('a');
  });

  it('TC-38 typing then clicking outside ends editing unselected', () => {
    const probe = setup();
    fireEvent.doubleClick(notes()[0]);
    fireEvent.input(textbox(), { target: { value: 'abc' } });
    fireEvent.pointerDown(screen.getByTestId('harness'), { pointerId: 1, button: 0 });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(text(probe)).toBe('abc');
    expect(probe.selectedId).toBeNull();
  });

  it('pressing inside the note while editing does not end editing', () => {
    setup('abc');
    fireEvent.doubleClick(notes()[0]);
    press(textbox(), 1, 1);
    release(textbox(), 1, 1);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('pasting 1,200 characters keeps 1,000 and shows 1000/1000', () => {
    const probe = setup();
    fireEvent.doubleClick(notes()[0]);
    fireEvent.input(textbox(), { target: { value: OVER_LIMIT_TEXT } });
    expect(text(probe)).toHaveLength(1000);
    expect(textbox().value).toHaveLength(1000);
    expect(screen.getByTestId('sticky-counter').textContent).toBe('1000/1000');
  });

  it('counter only appears within 50 characters of the limit', () => {
    setup();
    fireEvent.doubleClick(notes()[0]);
    fireEvent.input(textbox(), { target: { value: OVER_LIMIT_TEXT.slice(0, 949) } });
    expect(screen.queryByTestId('sticky-counter')).toBeNull();
    fireEvent.input(textbox(), { target: { value: OVER_LIMIT_TEXT.slice(0, 950) } });
    expect(screen.getByTestId('sticky-counter').textContent).toBe('950/1000');
  });

  it('reflects remote text changes while editing', () => {
    const probe = setup('a');
    fireEvent.doubleClick(notes()[0]);
    act(() => {
      probe.doc.transact(() => {
        const objects = probe.doc.getMap('objects');
        const note = objects.get([...objects.keys()][0]) as import('yjs').Map<unknown>;
        (note.get('text') as import('yjs').Text).insert(1, 'b');
      });
    });
    expect(textbox().value).toBe('ab');
  });
});
