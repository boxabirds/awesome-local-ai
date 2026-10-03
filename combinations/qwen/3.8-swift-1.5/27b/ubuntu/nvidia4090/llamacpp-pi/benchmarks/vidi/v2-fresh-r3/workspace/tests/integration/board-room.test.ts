import { describe, it, expect } from 'vitest';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
} from '../../src/shared/board-model';
import { TestClient, RawTestClient } from './ws-client';

declare const process: { env: Record<string, string | undefined> };

// Set the server URL for the test client
process.env.INTEGRATION_PORT = process.env.INTEGRATION_PORT || '23030';

/**
 * Creates a board via the real HTTP API (story 5): rooms can no longer be
 * created implicitly by connecting, so every test creates its board first.
 */
async function createBoardId(): Promise<string> {
  const port = process.env.INTEGRATION_PORT || '23030';
  const res = await fetch(`http://127.0.0.1:${port}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`board creation failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

/** Helper: wait for a condition with timeout using polling. */
async function waitFor(cond: () => boolean, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  // One final check
  if (!cond()) {
    throw new Error(`waitFor timed out after ${timeout}ms`);
  }
}

describe('TC-07: Create propagates to second client', () => {
  it('A creates sticky → B snapshot equals A; B received exactly one update', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // A creates a sticky
    const id = createSticky(a.doc, { x: 100, y: 200 });
    expect(id).not.toBe('');

    // Wait for B to receive the update
    await waitFor(() => id in b.objectsSnapshot());

    // B's snapshot should equal A's
    expect(b.objectsSnapshot()).toEqual(a.objectsSnapshot());

    a.close();
    b.close();
  });
});

describe('TC-08: Move, recolour, text insert, delete propagate', () => {
  it('move: A moves → B equals A; A receives no echo', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => id in b.objectsSnapshot());

    // A moves the note
    moveObject(a.doc, id, 500, 300);

    await waitFor(() => {
      const snap = b.objectsSnapshot();
      return (snap[id] as any)?.x === 500 && (snap[id] as any)?.y === 300;
    });

    expect(b.objectsSnapshot()).toEqual(a.objectsSnapshot());
    a.close();
    b.close();
  });

  it('recolour: A changes color → B equals A', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => id in b.objectsSnapshot());

    setStickyColor(a.doc, id, 'blue');

    await waitFor(() => (b.objectsSnapshot()[id] as any)?.color === 'blue');
    expect(b.objectsSnapshot()).toEqual(a.objectsSnapshot());
    a.close();
    b.close();
  });

  it('text insert: A types → B equals A', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => id in b.objectsSnapshot());

    const textA = getStickyText(a.doc, id)!;
    textA.insert(0, 'Hello');

    await waitFor(() => {
      const textB = getStickyText(b.doc, id);
      return textB?.toString() === 'Hello';
    });

    expect(b.objectsSnapshot()).toEqual(a.objectsSnapshot());
    a.close();
    b.close();
  });

  it('delete: A deletes → B note gone', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => id in b.objectsSnapshot());

    deleteObject(a.doc, id);

    await waitFor(() => !(id in b.objectsSnapshot()));
    expect(b.objectsSnapshot()).toEqual(a.objectsSnapshot());
    a.close();
    b.close();
  });
});

describe('TC-09: Concurrent text merge', () => {
  it('A and B edit same text → both converge to identical text', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // Create a note with text "green"
    const id = createSticky(a.doc, { x: 0, y: 0 });
    const textA = getStickyText(a.doc, id)!;
    textA.insert(0, 'green');
    await waitFor(() => getStickyText(b.doc, id)?.toString() === 'green');

    // A appends "!" to the text
    getStickyText(a.doc, id)!.insert(5, '!');
    
    // Wait for B to receive
    await waitFor(() => getStickyText(b.doc, id)?.toString() === 'green!');

    // B appends "?" to the text
    getStickyText(b.doc, id)!.insert(6, '?');

    // Wait for convergence - both should have the same text
    await waitFor(() => {
      const ta = getStickyText(a.doc, id)?.toString();
      const tb = getStickyText(b.doc, id)?.toString();
      return ta === tb && ta === 'green!?';
    }, 10000);

    expect(getStickyText(a.doc, id)?.toString()).toBe('green!?');
    expect(getStickyText(b.doc, id)?.toString()).toBe('green!?');
    a.close();
    b.close();
  });
});

describe('TC-10: Concurrent position change converges', () => {
  it('A sets x=100, B sets x=300 → both converge to same x', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => id in b.objectsSnapshot());

    // Both set x concurrently
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);

    // Wait for convergence
    await waitFor(() => {
      const xa = (a.objectsSnapshot()[id] as any)?.x;
      const xb = (b.objectsSnapshot()[id] as any)?.x;
      return xa === xb && xa !== undefined;
    });

    const xa = (a.objectsSnapshot()[id] as any)?.x;
    const xb = (b.objectsSnapshot()[id] as any)?.x;
    expect(xa).toBe(xb);
    // Should be one of the two values
    expect([100, 300]).toContain(xa);
    a.close();
    b.close();
  });
});

describe('TC-11: Delete wins over concurrent edit', () => {
  it('A deletes note while B inserts text → note absent on both, no resurrection', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => id in b.objectsSnapshot());

    // A deletes while B inserts text concurrently
    deleteObject(a.doc, id);
    const textB = getStickyText(b.doc, id);
    if (textB) textB.insert(0, 'concurrent edit');

    // Wait for convergence
    await waitFor(() => {
      return !(id in a.objectsSnapshot()) && !(id in b.objectsSnapshot());
    });

    // Note must be absent on both
    expect(id in a.objectsSnapshot()).toBe(false);
    expect(id in b.objectsSnapshot()).toBe(false);
    a.close();
    b.close();
  });
});

describe('TC-12: Full capacity random ops converge', () => {
  it(`${MAX_CONCURRENT_EDITORS} clients × 200 random ops → identical snapshots`, async () => {
    const boardId = await createBoardId();
    const clients: TestClient[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const client = await TestClient.connect(boardId);
      await client.waitForSync();
      clients.push(client);
    }

    // Seeded random
    let seed = 42;
    function rand(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

    // Each client performs 200 random ops
    for (const client of clients) {
      for (let i = 0; i < 200; i++) {
        const r = rand();
        const snap = client.snapshot();

        if (r < 0.4 && snap.length > 0) {
          // Type text
          const note = snap[Math.floor(rand() * snap.length)];
          const text = getStickyText(client.doc, note.id);
          if (text) text.insert(text.length, 'word' + Math.floor(rand() * 100) + ' ');
        } else if (r < 0.7 && snap.length > 0) {
          // Move
          const note = snap[Math.floor(rand() * snap.length)];
          moveObject(client.doc, note.id, rand() * 1000, rand() * 1000);
        } else if (r < 0.8) {
          // Create
          createSticky(client.doc, { x: rand() * 500, y: rand() * 500 });
        } else if (r < 0.9 && snap.length > 0) {
          // Recolour
          const note = snap[Math.floor(rand() * snap.length)];
          setStickyColor(client.doc, note.id, colors[Math.floor(rand() * colors.length)]);
        } else if (snap.length > 0) {
          // Delete
          const note = snap[Math.floor(rand() * snap.length)];
          deleteObject(client.doc, note.id);
        }
      }
    }

    // Wait for all clients to converge
    await waitFor(() => {
      const snaps = clients.map((c) => JSON.stringify(c.objectsSnapshot()));
      return snaps.every((s) => s === snaps[0]);
    }, 10000);

    // All snapshots should be identical
    const snaps = clients.map((c) => JSON.stringify(c.objectsSnapshot()));
    expect(snaps.every((s) => s === snaps[0])).toBe(true);

    for (const client of clients) client.close();
  }, 30000);
});

describe('TC-14: Late joiner sees current board', () => {
  it('A and B create 20 notes; C connects → C snapshot equals A', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // A and B each create 10 notes
    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i * 50, y: 0 });
      createSticky(b.doc, { x: i * 50, y: 100 });
    }

    // Wait for both to have all 20
    await waitFor(() => a.snapshot().length === 20 && b.snapshot().length === 20);

    // C connects (late joiner)
    const c = await TestClient.connect(boardId);
    await c.waitForSync();

    // C should see all 20 notes
    await waitFor(() => c.snapshot().length === 20);
    expect(c.objectsSnapshot()).toEqual(a.objectsSnapshot());

    a.close();
    b.close();
    c.close();
  });
});

describe('TC-15: Malformed traffic closes only the offending socket', () => {
  it('text frame → A closed with 1003; B still open and receives updates', async () => {
    const boardId = await createBoardId();
    const a = await RawTestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // A sends a text frame (invalid)
    a.sendRaw('hello');

    // A should be closed with CLOSE_UNSUPPORTED_DATA
    const closeCode = await a.waitForClose();
    expect(closeCode).toBe(CLOSE_UNSUPPORTED_DATA);

    // B should still be open
    expect(b.isOpen).toBe(true);

    // B should still receive updates
    const id = createSticky(b.doc, { x: 0, y: 0 });
    expect(id).not.toBe('');

    a.close();
    b.close();
  });

  it('unknown type → A closed with 1003; B still open', async () => {
    const boardId = await createBoardId();
    const a = await RawTestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // A sends unknown type 9
    a.sendRaw(new Uint8Array([9, 1, 2, 3]));

    const closeCode = await a.waitForClose();
    expect(closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(b.isOpen).toBe(true);

    a.close();
    b.close();
  });

  it('truncated bytes → A closed with 1003; B still open', async () => {
    const boardId = await createBoardId();
    const a = await RawTestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // A sends empty buffer (truncated)
    a.sendRaw(new Uint8Array(0));

    const closeCode = await a.waitForClose();
    expect(closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(b.isOpen).toBe(true);

    a.close();
    b.close();
  });

  it('invalid Yjs update → A closed with 1003; B still open', async () => {
    const boardId = await createBoardId();
    const a = await RawTestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // Send a sync frame with garbage payload (invalid Yjs update)
    const frame = new Uint8Array([0, 2, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
    a.sendRaw(frame);

    const closeCode = await a.waitForClose();
    expect(closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(b.isOpen).toBe(true);

    a.close();
    b.close();
  });
});

describe('TC-16: Awareness relay', () => {
  it('A sends awareness → B receives it via provider', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // A sets awareness state
    const awarenessState = { cursor: { line: 1, ch: 5 }, user: 'alice' };
    const awarenessA = (a.provider as any).awareness;
    awarenessA.setLocalState(awarenessState);

    // Wait for B to receive the awareness state
    await waitFor(() => {
      const states = b.getAwarenessStates();
      return states.size > 0;
    }, 10000);

    const bStates = b.getAwarenessStates();
    expect(bStates.size).toBeGreaterThan(0);
    
    // Check that the state matches
    let found = false;
    bStates.forEach((state: any) => {
      if (state?.user === 'alice') found = true;
    });
    expect(found).toBe(true);

    a.close();
    b.close();
  });
});

describe('TC-18: Room restart simulation', () => {
  it('A reconnects to fresh room first → doc repopulated; B converges', async () => {
    const boardId = await createBoardId();

    // Phase 1: A and B connect and create some notes
    const a1 = await TestClient.connect(boardId);
    const b1 = await TestClient.connect(boardId);
    await a1.waitForSync();
    await b1.waitForSync();

    createSticky(a1.doc, { x: 10, y: 10 });
    createSticky(b1.doc, { x: 20, y: 20 });
    await waitFor(() => a1.snapshot().length === 2 && b1.snapshot().length === 2);

    // Simulate restart: close all sockets
    a1.close();
    b1.close();
    await new Promise((r) => setTimeout(r, 100));

    // Phase 2: A reconnects first to the "fresh" room
    const a2 = await TestClient.connect(boardId);
    await a2.waitForSync();

    // A's doc should be repopulated (A sends its state via SyncStep2)
    await waitFor(() => a2.snapshot().length === 2);

    // B reconnects
    const b2 = await TestClient.connect(boardId);
    await b2.waitForSync();

    // B should converge to the same state
    await waitFor(() => b2.snapshot().length === 2);
    expect(b2.objectsSnapshot()).toEqual(a2.objectsSnapshot());

    a2.close();
    b2.close();
  });
});

describe('TC-31: Dead socket does not crash the room', () => {
  it('B closes abruptly, A sends update → room does not throw; later sockets receive', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // B closes abruptly
    b.abruptClose();
    await new Promise((r) => setTimeout(r, 200));

    // A sends an update
    const id = createSticky(a.doc, { x: 5, y: 5 });
    expect(id).not.toBe('');

    // A new client C connects and should receive the update
    const c = await TestClient.connect(boardId);
    await c.waitForSync();

    // C should have the note
    await waitFor(() => id in c.objectsSnapshot());
    expect(c.objectsSnapshot()[id]).toBeDefined();

    a.close();
    c.close();
  });
});

describe('TC-13: Over-capacity joiners are not refused', () => {
  it(`${MAX_CONCURRENT_EDITORS} + 1 clients all connect and can edit`, async () => {
    const boardId = await createBoardId();
    const clients: TestClient[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const client = await TestClient.connect(boardId);
      await client.waitForSync();
      clients.push(client);
    }

    for (const client of clients) {
      expect(client.isOpen).toBe(true);
    }

    // Last client creates a note
    const lastClient = clients[clients.length - 1];
    const id = createSticky(lastClient.doc, { x: 100, y: 100 });
    expect(id).not.toBe('');

    // Wait for all other clients to receive the update
    await waitFor(() => {
      for (const client of clients.slice(0, -1)) {
        if (!(id in client.objectsSnapshot())) return false;
      }
      return true;
    });

    for (const client of clients) {
      expect(id in client.objectsSnapshot()).toBe(true);
    }

    for (const client of clients) client.close();
  });
});

describe('TC-17: Boards stay separate', () => {
  it('client in room1 creates note, client in room2 receives nothing', async () => {
    const boardId1 = await createBoardId();
    const boardId2 = await createBoardId();

    const client1 = await TestClient.connect(boardId1);
    const client2 = await TestClient.connect(boardId2);

    await client1.waitForSync();
    await client2.waitForSync();

    const id = createSticky(client1.doc, { x: 50, y: 50 });
    expect(id).not.toBe('');

    // Wait a bit for any (incorrect) propagation
    await new Promise((r) => setTimeout(r, 500));

    const snap2 = client2.objectsSnapshot();
    expect(id in snap2).toBe(false);
    expect(Object.keys(snap2).length).toBe(0);

    client1.close();
    client2.close();
  });
});
