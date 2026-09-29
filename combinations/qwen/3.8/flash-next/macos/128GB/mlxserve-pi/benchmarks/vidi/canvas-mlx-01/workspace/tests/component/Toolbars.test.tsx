import { describe, expect, it } from 'vitest';
import {
  clickCreateButton,
  clickNoteDelete,
  clickSwatch,
  editorIn,
  isSelected,
  modelNote,
  noteCount,
  noteDown,
  noteEl,
  noteUp,
  renderSticky,
  seedNote,
} from './stickyHarness.js';
import { readCamera } from './harness.js';
import { STICKY_SIZE_WORLD } from '../../src/shared/config.js';

const CENTRE = { x: 640, y: 400 };

describe('note colour toolbar (TC-27)', () => {
  it('clicking the pink swatch recolours the note and keeps it selected', async () => {
    renderSticky();
    const id = await seedNote(0, 0, 'yellow');
    await noteDown(id, CENTRE.x, CENTRE.y);
    await noteUp(id, CENTRE.x, CENTRE.y);
    expect(isSelected(id)).toBe(true);

    await clickSwatch(id, 'pink');

    expect(modelNote(id)!.color).toBe('pink');
    expect(isSelected(id)).toBe(true);
  });
});

describe('create from the toolbar (TC-28)', () => {
  it('the Sticky note button creates one note at the viewport centre and opens it for editing', async () => {
    renderSticky();
    const camera = readCamera();

    await clickCreateButton();

    expect(noteCount()).toBe(1);
    const id = Array.from(document.querySelectorAll('[data-note-id]'))[0]!.getAttribute(
      'data-note-id',
    )!;
    // The world centre of the visible viewport: screen centre (640,400) -> world.
    // createSticky stores the top-left, so the centre is x + size/2.
    const half = STICKY_SIZE_WORLD / 2;
    const expectedCentreX = camera.x + 640;
    const expectedCentreY = camera.y + 400;
    expect(modelNote(id)!.x + half).toBeCloseTo(expectedCentreX, 6);
    expect(modelNote(id)!.y + half).toBeCloseTo(expectedCentreY, 6);
    expect(editorIn(id)).not.toBeNull();
  });
});

describe('delete from the note toolbar (TC-29)', () => {
  it('the bin button removes the note and clears the selection', async () => {
    renderSticky();
    const id = await seedNote(0, 0);
    await noteDown(id, CENTRE.x, CENTRE.y);
    await noteUp(id, CENTRE.x, CENTRE.y);
    expect(noteEl(id)).not.toBeNull();

    await clickNoteDelete(id);

    expect(noteEl(id)).toBeNull();
    expect(isSelected(id)).toBe(false);
    // Nothing was re-rendered in its place.
    expect(noteCount()).toBe(0);
  });
});
