import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../../src/shared/config';
import { getNotes, setCamera, type NoteInfo } from '../helpers/board';
import {
  dragNote,
  expectConnected,
  freshBoardId,
  join,
  type Participant,
} from '../helpers/participants';

/**
 * sync.client delivery at capacity (task 9, TC-30).
 *
 * MAX_CONCURRENT_EDITORS contexts, each with its own `connectBoard`
 * provider, make continuous seeded random edits *through the real UI*
 * (create, move, type, recolour, delete+recreate) for 60 s. For every
 * change we measure the time from the sender's local update to each
 * receiver's update (doc level: the DOM renders synchronously from it);
 * every latency must stay within the live-update budget, the badge must
 * stay hidden (`connected`) on every context throughout, and all final
 * board snapshots must be identical. Prints p50/p95/max.
 *
 * Layout (camera {x:-640, y:-400, zoom:0.5}): participant i owns row i;
 * row spacing 120 screen px leaves room for the 2×-scaled note toolbar
 * above row 0. Each participant only edits its own row, so markers
 * (expected values) are unambiguous.
 */

const CAM = { x: -640, y: -400, zoom: 0.5 };
const SOAK_MS = 60_000;
const OP_PERIOD_MS = 400;
const PALETTE = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;
const CHARSET = 'abcdefghijklmnopqrstuvwxyz';

/** Note k of participant i: screen centre of its home position. */
const homeScreen = (i: number, k: number) => ({ x: 195 + k * 125, y: 140 + i * 120 });
/** Note k of participant i: world top-left of its home position. */
const homeWorld = (i: number, k: number) => ({ x: -350 + k * 250, y: -220 + i * 240 });

/** World centre → screen (with CAM). */
const toScreen = (wx: number, wy: number) => ({
  x: (wx - CAM.x) * CAM.zoom,
  y: (wy - CAM.y) * CAM.zoom,
});

/** Deterministic PRNG (mulberry32) so the soak is reproducible from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Pending {
  q: Participant;
  probe: () => Promise<boolean>;
  t0: number;
  label: string;
}

test('TC-30 five editors x 60 s of seeded UI edits: every delivery within budget, badges hidden, boards identical', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const seed = 20260214;
  console.log(`TC-30 seed=${seed} duration=${SOAK_MS}ms editors=${MAX_CONCURRENT_EDITORS}`);

  const boardId = freshBoardId();
  const N = MAX_CONCURRENT_EDITORS;
  const participants: Participant[] = await Promise.all(
    Array.from({ length: N }, () => join(browser, boardId)),
  );

  const latencies: number[] = [];
  const failures: string[] = [];
  const pending: Pending[] = [];
  const stateSamples = new Map<number, string[]>();
  for (let i = 0; i < N; i++) stateSamples.set(i, []);
  let sampling = true;

  const sampler = (async () => {
    while (sampling) {
      for (let i = 0; i < N; i++) {
        const s = await participants[i].page.evaluate(
          () =>
            (window as unknown as { __vidi6?: { connectionState: string | null } }).__vidi6
              ?.connectionState ?? null,
        );
        stateSamples.get(i)!.push(s ?? 'null');
      }
      await sleep(500);
    }
  })();

  const flushPending = async (): Promise<void> => {
    const batch = pending.splice(0);
    await Promise.all(
      batch.map(async (chk) => {
        const deadline = chk.t0 + LIVE_UPDATE_LATENCY_BUDGET_MS;
        while (Date.now() < deadline) {
          if (await chk.probe()) {
            latencies.push(Date.now() - chk.t0);
            return;
          }
          await sleep(25);
        }
        failures.push(`${chk.label}: not visible on receiver within ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms`);
      }),
    );
  };

  /** The participant's five notes (row i is stable in y: moves drift x only). */
  const myNotes = async (i: number): Promise<NoteInfo[]> => {
    const baseY = homeWorld(i, 0).y;
    return (await getNotes(participants[i].page)).filter((n) => Math.abs(n.y - baseY) < 1);
  };

  /** Local convergence check before t0 (my own DOM is the sender reference). */
  const awaitLocal = async (
    probe: () => Promise<boolean>,
    label: string,
    diag?: () => Promise<string> | string,
  ): Promise<void> => {
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      if (await probe()) return;
      await sleep(10);
    }
    let detail = '';
    if (diag) {
      try {
        detail = ` [${await diag()}]`;
      } catch {
        detail = ' [diag failed]';
      }
    }
    console.log(`LOCAL-DID-NOT-LAND: ${label}${detail}`);
    throw new Error(`local update did not land: ${label}${detail}`);
  };

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  try {
    // Setup: every participant creates its row of five notes (unmeasured).
    for (let i = 0; i < N; i++) {
      await setCamera(participants[i].page, CAM);
      for (let k = 0; k < 5; k++) {
        const at = homeScreen(i, k);
        await participants[i].page.mouse.dblclick(at.x, at.y);
        await participants[i].page.keyboard.press('Escape');
      }
      expect((await myNotes(i)).length).toBe(5);
    }
    for (const p of participants) await expectConnected(p.page);

    // Soak: each participant runs its own seeded op loop for SOAK_MS.
    const deadline = Date.now() + SOAK_MS;
    await Promise.all(
      participants.map(async (p, i) => {
        const rng = mulberry32(seed + i * 7919);
        // Home slot per note id (for delete+recreate at the freed slot).
        const noteHome = new Map<string, number>();
        for (let k = 0; k < 5; k++) {
          const home = homeWorld(i, k);
          const n = (await myNotes(i)).find(
            (n) => Math.abs(n.x - home.x) < 1 && Math.abs(n.y - home.y) < 1,
          );
          if (n) noteHome.set(n.id, k);
        }
        while (Date.now() < deadline) {
          const opStart = Date.now();
          const roll = rng();
          const slot = Math.floor(rng() * 5);
          const notes = await myNotes(i);
          const note = notes[slot];
          if (note === undefined) continue;
          const centre = toScreen(note.x + 100, note.y + 100);
          const others = participants.filter((_, j) => j !== i);

          if (roll < 0.4) {
            // MOVE: oscillate the note within ±20 world of its home centre. Columns
            // are 250 world apart and notes are 200 wide, so ±20 keeps the note in
            // its own column and never overlaps a neighbour. (Accumulating drift —
            // the old behaviour — let two notes in a row share an x and overlap, so a
            // centre-click selected whichever was on top: the wrong note.)
            const homeK = noteHome.get(note.id) ?? slot;
            const homeCenterX = homeWorld(i, homeK).x + 100;
            const side = note.x < homeCenterX ? 1 : -1; // oscillate across home
            const targetX = homeCenterX + 20 * side;
            const dxScreen = Math.round((targetX - note.x) * CAM.zoom);
            await dragNote(p.page, centre.x, centre.y, dxScreen, 0);
            const id = note.id;
            // The note lands within ~1 world of targetX (screen-pixel rounding);
            // read the settled x as the reference for the cross-replica check.
            // NOTE: sentinel is `null`, not a number — x positions can be negative.
            let settledX: number | null = null;
            const refDeadline = Date.now() + 500;
            while (Date.now() < refDeadline) {
              const n = (await myNotes(i)).find((n) => n.id === id);
              if (n !== undefined && Math.abs(n.x - targetX) <= 1.5) {
                settledX = Math.round(n.x);
                break;
              }
              await sleep(10);
            }
            if (settledX === null) throw new Error(`local update did not land: move ${id} (targetX=${targetX})`);
            const settled = settledX;
            const t0 = Date.now();
            for (const q of others) {
              pending.push({
                q,
                t0,
                label: `move ${id} (editor ${i}, x=${settled})`,
                probe: async () => {
                  const n = (await getNotes(q.page)).find((n) => n.id === id);
                  return n !== undefined && Math.round(n.x) === settled;
                },
              });
            }
          } else if (roll < 0.65) {
            // TYPE: append a 3-char suffix (recycle the note once it gets long).
            if (note.text.length + 3 > 300) continue;
            const suffix = Array.from({ length: 3 }, () => CHARSET[Math.floor(rng() * 26)]).join('');
            await p.page.mouse.dblclick(centre.x, centre.y);
            await p.page.keyboard.press('Control+End');
            await p.page.keyboard.type(suffix);
            await p.page.keyboard.press('Escape');
            const id = note.id;
            await awaitLocal(
              async () => {
                const n = (await myNotes(i)).find((n) => n.id === id);
                return n !== undefined && n.text.endsWith(suffix);
              },
              `type ${id}`,
            );
            const t0 = Date.now();
            for (const q of others) {
              pending.push({
                q,
                t0,
                label: `type ${id} (editor ${i}, '${suffix}')`,
                probe: async () => {
                  const n = (await getNotes(q.page)).find((n) => n.id === id);
                  return n !== undefined && n.text.endsWith(suffix);
                },
              });
            }
          } else if (roll < 0.85) {
            // RECOLOUR: advance along the palette.
            const idx = PALETTE.indexOf(note.color as (typeof PALETTE)[number]);
            const next = PALETTE[(idx + 1) % PALETTE.length];
            await p.page.mouse.click(centre.x, centre.y);
            await p.page.getByRole('button', { name: `${cap(next)} colour` }).click();
            const id = note.id;
            await awaitLocal(
              async () => {
                const n = (await myNotes(i)).find((n) => n.id === id);
                return n !== undefined && n.color === next;
              },
              `recolor ${id}`,
              async () => {
                const all = await getNotes(p.page);
                const n = all.find((n) => n.id === id);
                const sel = (await p.page.locator('.vidi6-sticky--selected').count());
                return `now=${n?.color ?? 'MISSING'} expected=${next} selectedCount=${sel} myNotesLen=${(await myNotes(i)).length}`;
              },
            );
            const t0 = Date.now();
            for (const q of others) {
              pending.push({
                q,
                t0,
                label: `recolor ${id} (editor ${i}, ${next})`,
                probe: async () => {
                  const n = (await getNotes(q.page)).find((n) => n.id === id);
                  return n !== undefined && n.color === next;
                },
              });
            }
          } else {
            // DELETE + RECREATE at the note's home slot (the freed slot).
            const oldId = note.id;
            const homeSlot = noteHome.get(oldId) ?? slot;
            const home = homeScreen(i, homeSlot);
            const rowBefore = new Set((await myNotes(i)).map((n) => n.id));
            await p.page.mouse.click(centre.x, centre.y);
            await p.page.getByRole('button', { name: 'Delete note' }).click();
            await p.page.mouse.dblclick(home.x, home.y);
            await p.page.keyboard.press('Escape');
            const rowAfter = await myNotes(i);
            const newId = rowAfter.find((n) => !rowBefore.has(n.id))?.id;
            expect(newId, `recreate for editor ${i} slot ${homeSlot}`).toBeTruthy();
            noteHome.delete(oldId);
            noteHome.set(newId!, homeSlot);
            const t0 = Date.now();
            for (const q of others) {
              pending.push({
                q,
                t0,
                label: `delete+recreate (editor ${i}, ${oldId} -> ${newId})`,
                probe: async () => {
                  const notes = await getNotes(q.page);
                  return !notes.some((n) => n.id === oldId) && notes.some((n) => n.id === newId);
                },
              });
            }
          }

          await flushPending();
          // Keep the op rhythm (the soak is about sustained load, not speed).
          const elapsed = Date.now() - opStart;
          if (elapsed < OP_PERIOD_MS) await sleep(OP_PERIOD_MS - elapsed);
        }
      }),
    );

    // Settle: drain any in-flight checks, then stop sampling.
    await flushPending();
    sampling = false;
    await sampler;

    // Invariant: the badge stayed hidden (state `connected`) on every context.
    for (let i = 0; i < N; i++) {
      const bad = (stateSamples.get(i) ?? []).filter((s) => s !== 'connected');
      expect(bad, `editor ${i} left connected: ${bad.slice(0, 3)}`).toEqual([]);
    }
    // Invariant: every measured delivery was within budget.
    expect(failures, `latency budget violations:\n${failures.slice(0, 10).join('\n')}`).toEqual([]);
    expect(latencies.length).toBeGreaterThan(0);

    // Final board snapshots: identical on every context (doc + DOM).
    const docSnaps: string[] = [];
    const domSnaps: string[] = [];
    for (const p of participants) {
      const notes = (await getNotes(p.page))
        .map((n) => `${n.id}:${Math.round(n.x)},${Math.round(n.y)}:${n.color}:${n.text}`)
        .sort();
      docSnaps.push(JSON.stringify(notes));
      const dom = await p.page.locator('.vidi6-sticky').evaluateAll((els) =>
        els
          .map((el) => {
            const r = el.getBoundingClientRect();
            return `${el.getAttribute('data-note-id')}:${Math.round(r.x)},${Math.round(r.y)}`;
          })
          .sort(),
      );
      domSnaps.push(JSON.stringify(dom));
    }
    for (let i = 1; i < N; i++) {
      expect(docSnaps[i], `doc differs: editor ${i} vs 0`).toBe(docSnaps[0]);
      expect(domSnaps[i], `DOM differs: editor ${i} vs 0`).toBe(domSnaps[0]);
    }

    // No errors anywhere (a reconnect storm after a failed destroy would
    // surface as page errors / error console lines).
    for (let i = 0; i < N; i++) {
      expect(participants[i].pageErrors, `editor ${i} page errors`).toEqual([]);
      const errors = participants[i].consoleLines.filter((l) => l.startsWith('Uncaught'));
      expect(errors, `editor ${i} console errors`).toEqual([]);
    }

    // Teardown side effect: closing each context calls destroy(); nothing
    // (re)connects or logs after close.
    for (const p of participants) await p.close();
    await sleep(1500);
    // (Pages are gone: any leaked reconnect attempt would have already
    // surfaced as page errors above while the close was in progress.)

    // Report.
    const sorted = [...latencies].sort((a, b) => a - b);
    const q = (pct: number) => sorted[Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length))];
    console.log(
      `TC-30 OK: ${latencies.length} deliveries — p50=${q(50)}ms p95=${q(95)}ms max=${q(100)}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`,
    );
  } finally {
    sampling = false;
    await sampler.catch(() => undefined);
    for (const p of participants) await p.close().catch(() => undefined);
  }
}
);
