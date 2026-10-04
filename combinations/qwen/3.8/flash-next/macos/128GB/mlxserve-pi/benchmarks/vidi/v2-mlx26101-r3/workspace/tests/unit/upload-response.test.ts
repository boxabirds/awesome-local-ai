/**
 * The answer to an upload, read the way the service actually writes it.
 *
 * This seam is small - a response body goes in, an address comes out - and it was wrong in a way that no
 * test below the browser could catch: the client was written to take an asset id out of the body and build
 * the address itself, while the service was written to hand back the address whole. Both halves were
 * internally consistent, both were tested against what the other was *assumed* to say, and every test that
 * stubbed the other side went on passing while a real upload left a real board with a box that said "Upload
 * failed". The e2e run is what found it. So the two possible readings of the contract are both pinned here,
 * in the same file, on purpose: a body that carries an id and no key must be refused, not guessed at.
 *
 * The board's own half of the key is checked rather than trusted. Nothing in this story is more tempting to
 * wave through than an address - it is a string, it came from our own server, what could be wrong with it -
 * and a picture stored under a different board's key is bytes that board can be served but never asked for.
 */
import { describe, expect, it } from 'vitest';
import { assetKeyFromResponse } from '../../src/client/images/uploadImage';
import { ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';

describe('the answer to an upload', () => {
  it('hands back the address the service gave, whole', () => {
    const boardId = newBoardId();
    const assetKey = assetKeyFor(boardId, newBoardId());

    expect(
      assetKeyFromResponse(JSON.stringify({ assetKey, contentType: 'image/png' }), boardId),
    ).toBe(assetKey);
  });

  it('refuses a body that names a part of the address instead of the address', () => {
    const boardId = newBoardId();
    const assetId = newBoardId();

    // This is the bug, written down: an id is not an address, and an address has two halves. A client that
    // could have made one from the id did so once, on a board where the server had said something else,
    // and the picture it stored was unreachable from the box that was waiting for it.
    expect(assetKeyFromResponse(JSON.stringify({ assetId }), boardId)).toBeNull();
  });

  it('refuses an address belonging to another board', () => {
    const boardId = newBoardId();
    const somewhereElse = assetKeyFor(newBoardId(), newBoardId());

    expect(
      assetKeyFromResponse(
        JSON.stringify({ assetKey: somewhereElse, contentType: 'image/png' }),
        boardId,
      ),
    ).toBeNull();
  });

  it('refuses an address that is not an address', () => {
    const boardId = newBoardId();
    const bodies = [
      'not json at all',
      '',
      'null',
      '"a string"',
      '[]',
      JSON.stringify({ assetKey: null }),
      JSON.stringify({ assetKey: 42 }),
      JSON.stringify({ assetKey: '' }),
      JSON.stringify({ assetKey: `${boardId}/${'x'.repeat(21)}` }),
      JSON.stringify({ assetKey: `${boardId}/` }),
      JSON.stringify({ assetKey: boardId }),
      JSON.stringify({ assetKey: '../../etc/passwd' }),
    ];

    for (const body of bodies) {
      expect(
        assetKeyFromResponse(body, boardId),
        `a body like ${body} should not be read as an address`,
      ).toBeNull();
    }
    // And the shape that is accepted is the one the pattern describes, so the two cannot drift apart.
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(boardId, newBoardId()))).toBe(true);
  });

  it('takes no notice of what else the body says', () => {
    const boardId = newBoardId();
    const assetKey = assetKeyFor(boardId, newBoardId());

    // The type is in the body too, and it is not this function's business: the object already knows what it
    // is, from the bytes the client itself looked at before sending.
    expect(
      assetKeyFromResponse(
        JSON.stringify({ assetKey, contentType: 'application/octet-stream', extra: { a: 1 } }),
        boardId,
      ),
    ).toBe(assetKey);
  });
});
