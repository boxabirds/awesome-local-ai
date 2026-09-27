/**
 * Component tests for the toolbars (TC-27, TC-28, TC-29).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Harness, TEST_VIEWPORT, type HarnessResult } from './harness';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

let harness: HarnessResult | null = null;

const setup = () => {
  harness = null;
  render(<Harness onReady={(result) => (harness = result)} />);
  if (!harness) throw new Error('harness did not report ready');
  return harness;
};

beforeEach(() => {
  cleanup();
});

const press = (el: Element, x: number, y: number): void => {
  fireEvent(
    el,
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0 }),
  );
};
const release = (el: Element, x: number, y: number): void => {
  fireEvent(
    el,
    new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0 }),
  );
};

const note = (): HTMLElement => screen.getAllByTestId('sticky-note')[0] as HTMLElement;

const createAndSelect = (): string => {
  const { doc } = harness!;
  let id = '';
  act(() => {
    id = createSticky(doc, { x: 0, y: 0 });
  });
  press(note(), 400, 300);
  release(note(), 400, 300);
  return id;
};

describe('colour swatches (TC-27)', () => {
  it('TC-27: clicking the Pink swatch recolours the note and keeps text, position and selection', () => {
    setup();
    const id = createAndSelect();
    const ytext = getStickyText(harness!.doc, id);
    act(() => {
      harness!.doc.transact(() => ytext?.insert(0, 'Keep me'));
    });
    const before = snapshot(harness!.doc)[0];

    fireEvent.click(screen.getByLabelText('Pink colour'));

    const after = snapshot(harness!.doc)[0];
    expect(after.color).toBe('pink');
    expect(after.text).toBe('Keep me');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // Selection is kept, and the pressed swatch reflects the new colour.
    expect(note().dataset.selected).toBe('true');
    expect(screen.getByLabelText('Pink colour')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Yellow colour')).toHaveAttribute('aria-pressed', 'false');
  });

  it('swatches are named, not distinguished by colour alone', () => {
    setup();
    createAndSelect();
    for (const name of ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet']) {
      expect(screen.getByLabelText(`${name} colour`)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Delete note')).toBeInTheDocument();
  });
});

describe('create button (TC-28)', () => {
  it('TC-28: the Sticky note button creates one note centred in the viewport and edits it', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Sticky note'));

    const notes = snapshot(harness!.doc);
    expect(notes).toHaveLength(1);
    // Viewport centre in world units: camera starts at (-w/2, -h/2), zoom 1,
    // so the centre is (0, 0) and the note's top-left is -size/2.
    expect(notes[0].x).toBeCloseTo(-STICKY_SIZE_WORLD / 2);
    expect(notes[0].y).toBeCloseTo(-STICKY_SIZE_WORLD / 2);
    // Editing is active immediately.
    expect(screen.getByLabelText('Sticky note text')).toBeInTheDocument();
  });

  it('the create button carries the specified tooltip', () => {
    setup();
    const button = screen.getByLabelText('Sticky note');
    expect(button).toHaveAttribute('title', 'Sticky note – or double-click the board');
    void TEST_VIEWPORT;
  });
});

describe('delete button (TC-29)', () => {
  it('TC-29: the bin button removes the note and clears the selection', () => {
    setup();
    const id = createAndSelect();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Delete note'));

    expect(snapshot(harness!.doc)).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    void id;
  });
});
