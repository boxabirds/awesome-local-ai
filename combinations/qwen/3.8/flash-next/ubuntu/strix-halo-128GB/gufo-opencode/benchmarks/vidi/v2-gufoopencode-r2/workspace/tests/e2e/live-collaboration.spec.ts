// Task 8: E2E live collaboration with multiple browser contexts
// (TC-22 to TC-28), real browser + real wrangler dev server path.

import { test, expect } from '@playwright/test';
import { getNotes, setCamera } from './helpers/board';
import { CATCH_UP_TEST_OUTAGE_MS } from '../../src/shared/config';
import {
  closeParticipants,
  dragFromTo,
  eventually,
  noteCenter,
  openParticipants,
  signature,
  waitForNoteCount,
  waitForSync,
} from './helpers/participants';

test.describe('Two-person workshop', () => {
  test('TC-22: every change Alex makes appears live for Sam', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    try {
      // create + type
      await alex.page.mouse.dblclick(400, 300);
      await alex.page.keyboard.type('Hi');
      await alex.page.keyboard.press('Escape');
      await eventually(
        'TC-22 create+type reaches Sam',
        async () => {
          const notes = await getNotes(sam.page);
          return notes.length === 1 ? notes[0].text : null;
        },
        'Hi',
      );

      // move
      await dragFromTo(alex.page, [400, 300], [550, 400]);
      const moved = (await getNotes(alex.page))[0];
      await eventually(
        'TC-22 move reaches Sam',
        async () => {
          const s = (await getNotes(sam.page))[0];
          return s ? Math.round(s.x) === Math.round(moved.x) : false;
        },
        true,
      );

      // recolour (Alex's note stays selected after the drag)
      await alex.page.getByLabel('Pink colour').click();
      await eventually(
        'TC-22 recolour reaches Sam',
        async () => (await getNotes(sam.page))[0]?.color,
        'pink',
      );

      // delete
      await alex.page.getByLabel('Delete note').click();
      await eventually(
        'TC-22 delete reaches Sam',
        () => getNotes(sam.page).then((n) => n.length),
        0,
      );
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-23: both type simultaneously into one note; identical text with every character', async ({
    browser,
  }) => {
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    try {
      await alex.page.mouse.dblclick(400, 300);
      await alex.page.keyboard.press('Escape');
      await waitForSync([sam], 1);
      const [note] = await getNotes(alex.page);

      // Both open the editor for the same note.
      await alex.page.mouse.dblclick(400, 300);
      await sam.page.mouse.dblclick(400, 300);
      await expect(alex.page.getByTestId('sticky-textarea')).toBeVisible();
      await expect(sam.page.getByTestId('sticky-textarea')).toBeVisible();

      // Type at the same time (overlapping windows, not turn-by-turn).
      await Promise.all([
        alex.page.keyboard.type('aaaa', { delay: 20 }),
        (async () => {
          await sam.page.waitForTimeout(150);
          await sam.page.keyboard.type('bbbb', { delay: 20 });
        })(),
      ]);

      await eventually(
        'TC-23 identical 8-character text on both',
        async () => {
          const a = (await getNotes(alex.page)).find((n) => n.id === note.id)?.text ?? '';
          const s = (await getNotes(sam.page)).find((n) => n.id === note.id)?.text ?? '';
          return a === s && a.length === 8;
        },
        true,
      );
      const text = (await getNotes(alex.page)).find((n) => n.id === note.id)!.text;
      expect(text.split('').sort().join('')).toBe('aaaabbbb'); // every character survived
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-24: both drag the same note at once; identical settled position', async ({
    browser,
  }) => {
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    try {
      await alex.page.mouse.dblclick(400, 300);
      await alex.page.keyboard.press('Escape');
      await waitForSync([sam], 1);
      const [note] = await getNotes(alex.page);

      const alexFrom = await noteCenter(alex.page, note.id);
      const samFrom = await noteCenter(sam.page, note.id);
      await Promise.all([
        dragFromTo(alex.page, [alexFrom.x, alexFrom.y], [alexFrom.x + 150, alexFrom.y + 60]),
        dragFromTo(sam.page, [samFrom.x, samFrom.y], [samFrom.x - 120, samFrom.y + 90]),
      ]);

      await eventually(
        'TC-24 identical settled position',
        async () => {
          const a = (await getNotes(alex.page)).find((n) => n.id === note.id)!;
          const s = (await getNotes(sam.page)).find((n) => n.id === note.id)!;
          return a.x === s.x && a.y === s.y;
        },
        true,
      );
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-25: Alex deletes a note while Sam edits it; Sam loses note and editor, no console errors', async ({
    browser,
  }) => {
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    const samProblems: string[] = [];
    sam.page.on('console', (msg) => {
      if (msg.type() === 'error') samProblems.push(msg.text());
    });
    sam.page.on('pageerror', (err) => samProblems.push(String(err)));
    try {
      await alex.page.mouse.dblclick(400, 300);
      await alex.page.keyboard.press('Escape');
      await waitForSync([sam], 1);

      // Sam starts editing (selection is local: Sam's UI only).
      await sam.page.mouse.dblclick(400, 300);
      await expect(sam.page.getByTestId('sticky-textarea')).toBeVisible();

      // Alex deletes from the note toolbar.
      await alex.page.mouse.click(400, 300);
      await alex.page.getByLabel('Delete note').click();

      await waitForNoteCount(sam.page, 0);
      await expect(sam.page.getByTestId('sticky-textarea')).toHaveCount(0);
      await waitForNoteCount(alex.page, 0);
      expect(samProblems).toEqual([]);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });
});

test.describe('Full-capacity session', () => {
  test('TC-26: five participants each create 5 and move 5 notes; final boards identical', async ({
    browser,
  }) => {
    const names = ['P1', 'P2', 'P3', 'P4', 'P5'];
    const parties = await openParticipants(browser, names);
    try {
      // Zoom out so a 5x5 grid of notes fits on every identical viewport.
      for (const p of parties) await setCamera(p.page, { x: 0, y: 0, zoom: 0.5 });

      const myNoteIds = new Map<string, string[]>();
      for (const [i, p] of parties.entries()) {
        const ids: string[] = [];
        for (let j = 0; j < 5; j += 1) {
          const before = new Set((await getNotes(p.page)).map((n) => n.id));
          await p.page.mouse.dblclick(160 + i * 110, 160 + j * 110);
          await p.page.keyboard.press('Escape');
          const fresh = (await getNotes(p.page)).find((n) => !before.has(n.id));
          if (!fresh) throw new Error(`${p.name}: note ${j} was not created`);
          ids.push(fresh.id);
        }
        myNoteIds.set(p.name, ids);
      }
      await waitForSync(parties, 25);

      // Each participant drags their own five notes by a personal offset.
      for (const [i, p] of parties.entries()) {
        for (const id of myNoteIds.get(p.name)!) {
          const c = await noteCenter(p.page, id);
          await dragFromTo(p.page, [c.x, c.y], [c.x + 40 + i * 15, c.y + 30]);
        }
      }

      // "Every change seen by all others" == final board signatures identical.
      await eventually(
        'TC-26 all five boards identical',
        async () => {
          const sigs = await Promise.all(parties.map((p) => getNotes(p.page).then(signature)));
          return new Set(sigs).size;
        },
        1,
      );
    } finally {
      await closeParticipants(parties);
    }
  });
});

test.describe('Flaky Wi-Fi', () => {
  test('TC-27: offline outage, both keep editing, catch-up on reconnect', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    try {
      // Record every badge text change so the full Reconnecting -> Connected
      // sequence is provable even though the Connected badge hides after 2s.
      await alex.page.evaluate(() => {
        const seen: string[] = [];
        (window as unknown as { __badgeSeen?: string[] }).__badgeSeen = seen;
        const read = () => {
          const t = document.querySelector('[role="status"]')?.textContent ?? '';
          if (seen[seen.length - 1] !== t) seen.push(t);
        };
        new MutationObserver(read).observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        });
        read();
      });
      const outageStart = Date.now();
      await alex.context.setOffline(true);
      // setOffline does not drop established WebSocket connections; y-websocket
      // notices only after its 30s of silence (probe-verified ~33s), so the
      // offline badge appears late in the outage window.
      await expect
        .poll(() => alex.page.evaluate(() => window.__vidi6?.connectionState?.() ?? 'missing'), {
          timeout: 45_000,
        })
        .toBe('reconnecting');

      // Both add three notes during the outage (Alex offline: local only).
      for (const p of [alex, sam]) {
        for (let j = 0; j < 3; j += 1) {
          await p.page.mouse.dblclick(300 + j * 110, 250);
          await p.page.keyboard.press('Escape');
        }
      }
      await waitForNoteCount(alex.page, 3);
      await waitForNoteCount(sam.page, 3);

      // Stay offline for the configured outage window.
      const remaining = CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStart);
      if (remaining > 0) await alex.page.waitForTimeout(remaining);

      await alex.context.setOffline(false);
      await expect
        .poll(() => alex.page.evaluate(() => window.__vidi6?.connectionState?.() ?? 'missing'), {
          timeout: 30_000,
        })
        .toMatch(/^(connected|confirmed)$/);

      await waitForSync([alex, sam], 6);
      const seen = await alex.page.evaluate(
        () => (window as unknown as { __badgeSeen?: string[] }).__badgeSeen ?? [],
      );
      expect(seen.some((t) => t.includes('Reconnecting'))).toBe(true);
      expect(seen.some((t) => t.includes('Connected'))).toBe(true);
      const [aNotes, sNotes] = await Promise.all([getNotes(alex.page), getNotes(sam.page)]);
      expect(signature(aNotes)).toBe(signature(sNotes));
    } finally {
      await closeParticipants([alex, sam]);
    }
  });
});

test('TC-28: Alex selection and editor are invisible to Sam', async ({ browser }) => {
  const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
  try {
    await alex.page.mouse.dblclick(400, 300);
    await alex.page.keyboard.type('mine');
    await alex.page.keyboard.press('Escape');
    await waitForSync([sam], 1);

    // Alex selects and edits.
    await alex.page.mouse.click(400, 300);
    await alex.page.mouse.dblclick(400, 300);
    await expect(alex.page.getByTestId('sticky-textarea')).toBeVisible();

    await sam.page.waitForTimeout(500); // any leaked selection UI would appear
    await expect(sam.page.locator('[data-selected="true"]')).toHaveCount(0);
    await expect(sam.page.getByTestId('sticky-textarea')).toHaveCount(0);
  } finally {
    await closeParticipants([alex, sam]);
  }
});
