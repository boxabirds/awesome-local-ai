/**
 * A selection is one person's, and it is kept honest by what happens to the board underneath it.
 *
 * TC-35 is the case no component test can ask: the objects a person is holding are deleted by
 * somebody else, over the network, while the bar is on the screen telling that person how many
 * things they are about to change. The count has to fall by itself - not because the app was told,
 * but because the objects it named are no longer there. A bar that kept saying "3 selected" after
 * one of the three had been deleted would be the most expensive kind of lie this product can tell:
 * the person presses Delete believing they are choosing between two things they can see, and the
 * number they trusted is not describing the board they are looking at.
 *
 * Two people, two browser contexts, one board: Lee holding a selection, Sam holding a mouse over
 * the same notes, which is exactly what two people on one board is.
 */

import { expect, test } from '@playwright/test';
import { readCamera } from './helpers/board';
import {
  Cast,
  boardJson,
  faces,
  logScenario,
  measureChange,
  waitForSameBoard,
} from './helpers/participants';
import {
  barText,
  createNotesAt,
  outlineIds,
  places,
  pressBoardKey,
  selectAllWithKeyboard,
  selectObject,
  waitForBar,
  waitForOutlines,
} from './helpers/selection';
import { notes } from './helpers/sticky';

/** Three notes in a row, far enough apart that one can be pressed without touching another. */
const ROW = [
  { x: -300, y: 0 },
  { x: 0, y: 0 },
  { x: 300, y: 0 },
];

test.describe('a colleague deletes what I have selected (TC-35)', () => {
  test('the count in the bar falls by itself, and the selection goes on working', async ({
    browser,
  }) => {
    const cast = await Cast.open(browser, 'Lee', 'Sam');
    const started = Date.now();
    try {
      const lee = cast.by('Lee');
      const sam = cast.by('Sam');

      // Lee makes three notes, and both screens come to agree about them.
      const ids = await createNotesAt(lee.page, ROW);
      await waitForSameBoard(cast.people);
      expect(JSON.parse(await boardJson(lee.page))).toHaveLength(3);

      // Lee selects all three. The board says so on Lee's screen...
      await selectAllWithKeyboard(lee.page);
      await waitForBar(lee.page, '3 selected');
      await waitForOutlines(lee.page, ids);

      // ...and says nothing of the kind on Sam's. Selection is not part of what the board holds:
      // two people looking at one board see the same notes and choose for themselves.
      expect(await outlineIds(sam.page)).toEqual([]);
      expect(await barText(sam.page)).toBeNull();

      // Sam picks one of Lee's three, and deletes it. The click is Sam's selection, and it is
      // drawn on Sam's screen only.
      await selectObject(sam.page, ids[1]!);
      await waitForOutlines(sam.page, [ids[1]!]);

      await measureChange(
        'a colleague deleting one of my selected notes',
        () => pressBoardKey(sam.page, 'Delete'),
        async () => (await barText(lee.page)) === '2 selected',
      );

      // Lee's bar now counts what is left, and the outlines were redrawn without the note that
      // went away. Both are read off the screen, so neither is the app agreeing with itself.
      await waitForBar(lee.page, '2 selected');
      await waitForOutlines(lee.page, [ids[0]!, ids[2]!]);
      expect(await outlineIds(lee.page)).not.toContain(ids[1]!);

      // The other person's screen has no interest in any of this, and still holds nothing.
      expect(await outlineIds(sam.page)).toEqual([]);

      // Both people are looking at two notes.
      await expect(notes(lee.page)).toHaveCount(2);
      await expect(notes(sam.page)).toHaveCount(2);
      await waitForSameBoard(cast.people);

      // Lee's selection is still a selection: it can be moved, and Sam sees the same board
      // afterwards. A selection that had gone stale would either move nothing or move the note
      // that is no longer there.
      const before = await places(lee.page);
      await pressBoardKey(lee.page, 'ArrowRight');
      await pressBoardKey(lee.page, 'ArrowRight');
      const moved = await places(lee.page);
      for (const id of [ids[0]!, ids[2]!]) {
        expect(moved.get(id)!.x - before.get(id)!.x).toBeCloseTo(2, 6);
      }
      await waitForSameBoard(cast.people);

      // And the two remaining notes are the only ones anybody can still select.
      await selectAllWithKeyboard(sam.page);
      await waitForBar(sam.page, '2 selected');
      expect(await outlineIds(sam.page)).toHaveLength(2);

      logScenario('two people, one deleted note, one pruned selection', started);
    } finally {
      await cast.close();
    }
  });

  test('a selection of one loses its toolbar and its note together', async ({ browser }) => {
    // The same pruning at the smaller end of the range: one note selected, and a colleague deletes
    // it. There is no bar for a single note - its own toolbar is what is on the screen - so what
    // has to go quiet is the toolbar, and the selection has to end up empty rather than holding an
    // id that names nothing.
    const cast = await Cast.open(browser, 'Lee', 'Sam');
    try {
      const lee = cast.by('Lee');
      const sam = cast.by('Sam');

      const ids = await createNotesAt(lee.page, ROW);
      await waitForSameBoard(cast.people);

      await selectObject(lee.page, ids[0]!);
      await waitForOutlines(lee.page, [ids[0]!]);
      await expect(lee.page.getByTestId('note-toolbar')).toBeVisible();

      await selectObject(sam.page, ids[0]!);
      await pressBoardKey(sam.page, 'Delete');

      // Lee's screen loses the note, the outline and the toolbar, and gains nothing in their place.
      await expect(notes(lee.page)).toHaveCount(2);
      await waitForOutlines(lee.page, []);
      await expect(lee.page.getByTestId('note-toolbar')).toHaveCount(0);
      expect(await barText(lee.page)).toBeNull();

      // Nothing is selected, so the keys that need a selection have nothing to act on - and the
      // board that is left is untouched by trying them.
      const untouched = await boardJson(lee.page);
      await pressBoardKey(lee.page, 'Delete');
      await pressBoardKey(lee.page, 'ArrowUp');
      expect(await boardJson(lee.page)).toBe(untouched);

      // Sam, who did the deleting, is left holding the same nothing.
      expect(await outlineIds(sam.page)).toEqual([]);
      expect(await faces(sam.page)).toHaveLength(2);
    } finally {
      await cast.close();
    }
  });

  test('a whole selection can go away while the board is being looked at', async ({ browser }) => {
    // The last member of a selection going is the boundary the design calls out: a selection that
    // loses everything must become empty rather than a selection of nothing, which is a different
    // thing - it has no bar, no handles, and no opinions about the arrow keys.
    const cast = await Cast.open(browser, 'Lee', 'Sam');
    try {
      const lee = cast.by('Lee');
      const sam = cast.by('Sam');

      const ids = await createNotesAt(lee.page, ROW);
      await waitForSameBoard(cast.people);

      await selectAllWithKeyboard(lee.page);
      await waitForBar(lee.page, '3 selected');
      const camera = await readCamera(lee.page);

      // Sam deletes all three, one after the other.
      for (const id of ids) {
        await selectObject(sam.page, id);
        await pressBoardKey(sam.page, 'Delete');
      }

      await expect(notes(lee.page)).toHaveCount(0);
      // The bar went with them: not "0 selected", which is a bar telling you about nothing, but no
      // bar at all.
      expect(await barText(lee.page)).toBeNull();
      expect(await outlineIds(lee.page)).toEqual([]);

      // And the board is still a board: nudging an empty selection does not move the view, and the
      // camera that was there before the last note went is the camera that is there now.
      await pressBoardKey(lee.page, 'ArrowDown');
      expect(await readCamera(lee.page)).toEqual(camera);

      await selectAllWithKeyboard(lee.page);
      expect(await barText(lee.page)).toBeNull();
    } finally {
      await cast.close();
    }
  });
});
