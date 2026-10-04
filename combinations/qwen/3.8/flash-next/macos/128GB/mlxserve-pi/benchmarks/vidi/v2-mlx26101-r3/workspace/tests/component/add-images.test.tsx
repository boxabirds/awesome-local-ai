/**
 * What the board does when somebody hands it pictures.
 *
 * Three doors - drop, paste, picker - and the same rules behind all three: the files are checked
 * before anything is written, what appears is a promise of a picture rather than a picture, the
 * upload is reported as it goes, and the board says out loud what it refused. Those rules are what
 * this file checks, at the one level where all three doors and the document behind them are visible
 * at once: a board mounted with a real document, connected to a room that is not real, handed files
 * that a browser did not produce, over an upload that never left the building.
 *
 * What is deliberately *not* here: whether a server accepts an upload (that is
 * `tests/integration/assets.test.ts`), whether a browser really shows a file picker (only a real
 * browser knows, and `tests/e2e/images.spec.ts` asks it), and whether a picture looks right (see
 * the end-to-end suite). Every one of those questions has exactly one home.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { imageSnapshots } from '../../src/shared/objects/image';
import { assetKeyFor } from '../../src/shared/image-format';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  aBoardId,
  dragEvent,
  imageFile,
  installImageBitmapStub,
  mountImageBoard,
  otherFile,
  textDragEvent,
  type BoardWithPictures,
} from './helpers/images';
import { doubleClick, pressKey } from './helpers/sticky';
import { forgetProviders } from './helpers/fake-provider';
import { flushFrames } from './helpers';
import {
  arrived,
  forgetUploads,
  lost,
  reportProgress,
  refused,
  settleUpload,
  upload,
  uploads,
} from './doubles/uploadImage';

/**
 * Both of these are hoisted above every import in this file, which is why neither double is written
 * out here: the factories reach for modules, and a factory that reached for anything that imported the
 * app would be importing the very module it is replacing. `y-websocket` is stubbed for the usual reason
 * in this suite - see `helpers/fake-provider`; the upload is stubbed because no component test should
 * wait for a network that is not there, or fail because one happened to be.
 */
vi.mock('../../src/client/images/uploadImage', async () => await import('./doubles/uploadImage'));
vi.mock('y-websocket', async () => {
  const helper = await import('./helpers/fake-provider');
  return helper.yWebsocketStub();
});

/** An asset id in the shape the room sends one: 22 characters of a board id are 22 characters of an asset id. */
function anAssetId(): string {
  return aBoardId();
}

/**
 * What the room answers an upload with: not an asset id on its own, but the whole key the bytes are
 * stored under. A double that sent back something shorter would be a double the client would accept
 * and the browser could not use.
 */
function theKey(boardId: string, assetId: string): string {
  return assetKeyFor(boardId, assetId);
}

const VIEW_CENTRE = { x: 640, y: 400 };

/** What a document holds, when there is no board drawn on the screen to look at. */
function imageSnapshotsOf(doc: Y.Doc) {
  return imageSnapshots(doc);
}

describe('dropping pictures on a board', () => {
  let board: BoardWithPictures;
  let doc: Y.Doc;
  // How many times the board changed, counted by whose hand did it: its own, or somebody else's.
  let localWrites = 0;
  let otherWrites = 0;

  beforeEach(async () => {
    forgetProviders();
    forgetUploads();
    installImageBitmapStub();
    localWrites = 0;
    otherWrites = 0;
    board = await mountImageBoard();
    doc = board.doc;
  });

  /** TC-17: three files, one row, three uploads, three pictures. */
  it('puts three dropped files in a row at the point they were dropped', async () => {
    const files = [imageFile('a-640x360.png'), imageFile('b-200x200.png'), imageFile('c-100x400.png')];
    const at = { x: 100, y: 100 };
    await board.drop(files, at);

    const placed = board.images();
    expect(placed).toHaveLength(3);
    const drop = board.worldOf(at);

    // The row starts at the drop point - not at the pointer's last position some other way, and not
    // wherever the first file's own size would have put it.
    expect(board.place(placed[0]!.id)).toMatchObject({ x: drop.x, y: drop.y });
    expect(board.place(placed[0]!.id).width).toBe(640);
    expect(board.place(placed[1]!.id).width).toBe(200);
    expect(board.place(placed[2]!.id).width).toBe(100);

    // Along, then along again: the gap between one and the next is the gap, and the row is as tall as
    // its tallest picture, so every one of them sits on the same line.
    expect(board.place(placed[1]!.id).x).toBe(
      board.place(placed[0]!.id).x + board.place(placed[0]!.id).width + IMAGE_LAYOUT_GAP_WORLD,
    );
    expect(board.place(placed[2]!.id).x).toBe(
      board.place(placed[1]!.id).x + board.place(placed[1]!.id).width + IMAGE_LAYOUT_GAP_WORLD,
    );
    const tallest = Math.max(...placed.map((image) => board.place(image.id).height));
    for (const image of placed) {
      expect(board.place(image.id).y).toBe(drop.y);
    }
    expect(tallest).toBe(400);

    // One upload per file, each to this board's own address, none of them awaited before the
    // placeholders went in.
    expect(uploads).toHaveLength(3);
    expect(uploads.map((held) => held.boardId)).toEqual([board.boardId, board.boardId, board.boardId]);
    expect(placed.every((image) => image.status === 'uploading')).toBe(true);
  });

  it('reports how far each upload has got, to the person who started it', async () => {
    const assetId = anAssetId();
    await board.drop([imageFile('one-400x300.png'), imageFile('two-400x300.png')]);
    const [first, second] = board.images();

    await reportProgress(0, 0.5);
    expect(board.element(first!.id).textContent).toContain('50%');
    // The other picture is still only waiting, and says so: progress belongs to the transfer that
    // reported it, not to every picture on the board.
    expect(board.element(second!.id).textContent).toContain('0%');

    await reportProgress(0, 1);
    expect(board.element(first!.id).textContent).toContain('100%');

    await settleUpload(0, arrived(theKey(board.boardId, assetId)));
    const ready = board.images();
    expect(ready[0]!.status).toBe('ready');
    expect(ready[0]!.assetKey).toBe(`${board.boardId}/${assetId}`);
    // The picture is asked for from the address it was stored at, and nowhere else.
    const picture = board.element(ready[0]!.id).querySelector('img');
    expect(picture?.getAttribute('src')).toBe(`/api/assets/${ready[0]!.assetKey}`);
    // The other picture is still waiting, and the person who dropped it is told how little of it has
    // arrived - not that it is uploading in words, which they already know: they are the one sending it.
    expect(ready[1]!.status).toBe('uploading');
    expect(board.element(ready[1]!.id).textContent).toContain('0%');
  });

  /** TC-18: the keyboard belongs to whoever is typing. */
  it('leaves a paste alone while a note is being written', async () => {
    doubleClick(board.board, { x: 300, y: 300 });
    await board.settle();
    const editor = screen.getByTestId('sticky-note-editor');
    expect(board.view.getByTestId('sticky-note')).toBeTruthy();

    await board.paste([imageFile('photo-400x300.png')], editor);

    expect(board.images()).toEqual([]);
    expect(uploads).toHaveLength(0);
    // The board is not even offended: nothing was said about it.
    expect(board.toast()).toBeNull();
  });

  it('pastes a picture into the middle of what is on the screen when the board has the keyboard', async () => {
    await board.paste([imageFile('photo-400x300.png')]);

    const images = board.images();
    expect(images).toHaveLength(1);
    const place = board.place(images[0]!.id);
    const centre = board.worldOf(VIEW_CENTRE);
    // "Where I am looking", in world units: the middle of the picture is the middle of the screen.
    expect(place.x + place.width / 2).toBeCloseTo(centre.x, 6);
    expect(place.y + place.height / 2).toBeCloseTo(centre.y, 6);
    expect(uploads).toHaveLength(1);
  });

  it('does not claim a paste of text', async () => {
    await board.paste([]);
    expect(board.images()).toEqual([]);
    expect(uploads).toHaveLength(0);
    expect(board.toast()).toBeNull();
  });

  /** TC-19: the board is not reachable, and says so instead of promising a picture. */
  it('refuses to add a picture while the connection is down', async () => {
    board.disconnect();
    await flushFrames(2);

    await board.drop([imageFile('photo-400x300.png')]);

    expect(board.images()).toEqual([]);
    expect(uploads).toHaveLength(0);
    expect(board.toast()).toBe(REJECTION_MESSAGES.offline);
  });

  it('adds the picture again once the connection comes back', async () => {
    board.disconnect();
    await flushFrames(2);
    await board.drop([imageFile('gone-400x300.png')]);
    expect(board.images()).toEqual([]);

    // The message about the files that were not sent stays until it is dismissed: a board that
    // forgot its own bad news as soon as the connection blinked would be a board that lost the reason
    // nobody had read yet.
    await board.click('toast-dismiss');
    expect(board.toast()).toBeNull();

    board.reconnect();
    await flushFrames(2);
    await board.drop([imageFile('here-400x300.png')]);

    expect(board.images()).toHaveLength(1);
    expect(board.toast()).toBeNull();
  });

  /** TC-29: one file that is not a picture does not take the other two with it. */
  it('adds the files it can and says what it would not touch', async () => {
    await board.drop([imageFile('good-400x300.png'), imageFile('corrupt.png'), imageFile('also-400x300.png')]);

    // The two files that could be decoded are on the board, in the order they came; the one that
    // could not is not, and was never sent.
    expect(uploads.map((held) => held.file.name)).toEqual(['good-400x300.png', 'also-400x300.png']);
    expect(board.images()).toHaveLength(2);
    expect(board.toast()).toBe(REJECTION_MESSAGES.type);
  });

  it('says what it refused and still adds what it took', async () => {
    await board.drop([otherFile('notes.pdf'), imageFile('photo-400x300.png')]);

    expect(board.images()).toHaveLength(1);
    expect(board.toast()).toBe(REJECTION_MESSAGES.type);
  });

  it('says when a picture is too big to send, without sending it', async () => {
    await board.drop([imageFile('huge-400x300.png', IMAGE_MAX_BYTES + 1)]);

    expect(board.images()).toEqual([]);
    expect(uploads).toHaveLength(0);
    expect(board.toast()).toBe(REJECTION_MESSAGES.size);
  });

  it('keeps the first pictures and says the rest will have to wait', async () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 3 }, (_unused, index) =>
      imageFile(`photo-${String(index)}-400x300.png`),
    );
    await board.drop(files);

    expect(board.images()).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(uploads).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(board.toast()).toBe(REJECTION_MESSAGES.count);
  });

  it('dismisses the message when it is asked to, and goes on working', async () => {
    await board.drop([otherFile('notes.pdf')]);
    expect(board.toast()).toBe(REJECTION_MESSAGES.type);

    await board.click('toast-dismiss');
    expect(board.toast()).toBeNull();

    await board.drop([imageFile('photo-400x300.png')]);
    expect(board.images()).toHaveLength(1);
  });

  it('says the bad news once, and lets the good news through', async () => {
    await board.drop([otherFile('one.pdf'), otherFile('two.pdf'), imageFile('photo-400x300.png')]);

    // One message about two refusals: the person asked one question - what happened to my files?
    expect(board.toast()).toBe(REJECTION_MESSAGES.type);
    expect(board.images()).toHaveLength(1);
  });

  it('lights up where the files would land', async () => {
    expect(screen.queryByTestId('drop-highlight')).toBeNull();

    const files = [imageFile('photo-400x300.png')];
    board.dragEnter(files);
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();

    board.dragOver(files);
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();

    board.dragLeave(files);
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });

  it('stays quiet about a drag that carries no files', async () => {
    // A drag of selected text, or a link dragged out of another tab: the board is not a place those
    // things go, and it does not pretend otherwise by lighting up.
    board.board.dispatchEvent(textDragEvent('dragenter'));
    board.board.dispatchEvent(textDragEvent('dragover'));
    await board.settle();
    expect(screen.queryByTestId('drop-highlight')).toBeNull();

    // A drag that carries text *and* files - which is what dragging a picture out of most browsers is -
    // is a file drag as far as the board is concerned: the files are the part it has an answer for.
    board.board.dispatchEvent(textDragEvent('dragenter', ['text/plain', 'Files']));
    await board.settle();
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();
  });

  it('gives up on a drop that carried nothing it could use', async () => {
    board.board.dispatchEvent(dragEvent('drop', []));
    await board.settle();

    expect(board.images()).toEqual([]);
    expect(uploads).toHaveLength(0);
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    // Nothing was said, because nothing was refused: an empty drop is not a mistake.
    expect(board.toast()).toBeNull();
  });

  it('hangs up on an upload when the board is closed', async () => {
    await board.drop([imageFile('photo-400x300.png')]);
    expect(uploads).toHaveLength(1);

    board.view.unmount();

    // Not because the person asked: because there is nobody left to tell that it arrived.
    expect(upload(0).aborts).toBe(1);
  });

  /** TC-24's first half, at the level where the file is still held in memory. */
  it('tries again, with the file it kept, and gets a picture out of it', async () => {
    await board.drop([imageFile('photo-400x300.png')]);
    await settleUpload(0, lost());
    const id = board.images()[0]!.id;
    expect(board.images()[0]!.status).toBe('failed');

    const retry = board.element(id).querySelector<HTMLButtonElement>('[data-testid="image-retry"]');
    expect(retry).not.toBeNull();
    await board.clickIn(id, 'image-retry');

    expect(board.images()[0]!.status).toBe('uploading');
    // The same file, the second time: a retry that sent the file it had was a retry that sent nothing.
    expect(uploads).toHaveLength(2);
    expect(upload(1).file).toBe(upload(0).file);

    await settleUpload(1, arrived(theKey(board.boardId, anAssetId())));
    expect(board.images()[0]!.status).toBe('ready');
  });

  it('reports a picture that failed as failed, and not as a picture', async () => {
    await board.drop([imageFile('photo-400x300.png')]);
    await settleUpload(0, lost());

    const image = board.images()[0]!;
    expect(image.status).toBe('failed');
    // Nothing to show, so nothing is claimed: no address the board would go and look at.
    expect(image.assetKey).toBeNull();
    expect(board.element(image.id).querySelector('img')).toBeNull();
  });

  it('believes the room over its own arithmetic about a picture that is too big', async () => {
    // 640x360 of anything is well under 10 MB by the count; the room has other ideas.
    const file = imageFile('photo-640x360.png', 1_000);
    await board.drop([file]);
    await settleUpload(0, refused(413));

    expect(board.images()[0]!.status).toBe('failed');
    expect(board.toast()).toBe(REJECTION_MESSAGES.size);
  });

  it('believes the room about a picture it will not take either', async () => {
    await board.drop([imageFile('photo-400x300.png')]);
    await settleUpload(0, refused(415));

    expect(board.images()[0]!.status).toBe('failed');
    expect(board.toast()).toBe(REJECTION_MESSAGES.type);
  });

  it('does not invent a reason the room did not give', async () => {
    await board.drop([imageFile('photo-400x300.png')]);
    await settleUpload(0, refused(500));

    expect(board.images()[0]!.status).toBe('failed');
    // A failure that needs no explaining is a failure; the message is for the files that were refused
    // before they went, not for a transfer that fell over on the way.
    expect(board.toast()).toBeNull();
  });

  it("does not offer a second attempt to the person who has no file", async () => {
    await board.drop([imageFile('photo-400x300.png')]);
    await settleUpload(0, lost());
    const id = board.images()[0]!.id;
    expect(board.element(id).querySelector('[data-testid="image-retry"]')).not.toBeNull();

    // The same board, opened again: the document remembers the failed picture, and nothing remembers
    // the file it came from.
    board.view.unmount();
    forgetProviders();
    const again = await mountImageBoard(board.boardId, board.doc);
    expect(again.images()[0]!.status).toBe('failed');
    expect(again.element(id).querySelector('[data-testid="image-retry"]')).toBeNull();
    expect(again.element(id).querySelector('[data-testid="image-remove"]')).not.toBeNull();
    again.view.unmount();
  });

  /** TC-29's second half: whose hand wrote what. */
  it("writes a picture's arrival with a hand that undo does not remember", async () => {
    // A colleague who joins the board now: handed what it holds at this moment, and told only what changes
    // afterwards - which is what a room does, and the only way to find out what this board really said to
    // anybody else. Nothing is done to their copy after this: nobody drives it, tells it what to render, or
    // hands it the files, so whatever it ends up holding is what was written.
    const colleague = new Y.Doc();
    Y.applyUpdate(colleague, Y.encodeStateAsUpdate(doc));
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) {
        localWrites += 1;
      } else {
        otherWrites += 1;
      }
      Y.applyUpdate(colleague, update);
    });

    await board.drop([imageFile('photo-400x300.png')]);
    const id = board.images()[0]!.id;
    // The box itself is the board's own work: it is what Ctrl+Z is for.
    expect(localWrites).toBeGreaterThan(0);
    const afterPlacing = otherWrites;

    await settleUpload(0, arrived(theKey(board.boardId, anAssetId())));
    // And the picture arriving is not: an upload that finished is news about the world, not something
    // anybody asked the board to do. If it were tracked, one undo after three pictures arrived would undo
    // a status change and leave three empty boxes on the board - which is the one outcome a person would
    // call a bug, and it would come from an origin nobody chose on purpose.
    expect(otherWrites).toBeGreaterThan(afterPlacing);
    expect(board.images()[0]!.status).toBe('ready');

    // What the colleague was told, in the same bytes: the same box, the same state, and the uploader's
    // name - which is not theirs. That is why they get a sentence about the picture and no percentage,
    // and it is not a decision the screen makes: it is in the document.
    const theirs = imageSnapshots(colleague);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]!.id).toBe(id);
    expect(theirs[0]!.status).toBe('ready');
    expect(theirs[0]!.uploaderId).toBe(String(doc.clientID));
    expect(theirs[0]!.uploaderId).not.toBe(String(colleague.clientID));
    colleague.destroy();
  });

  it('removes a failed picture for everybody', async () => {
    await board.drop([imageFile('photo-400x300.png')]);
    await settleUpload(0, lost());
    const id = board.images()[0]!.id;

    await board.clickIn(id, 'image-remove');
    await board.settle();

    expect(board.images()).toEqual([]);
    // Hanging up is not part of removing it: the transfer was already over.
    expect(upload(0).aborts).toBe(0);
  });

  it("writes nothing about an upload that was abandoned", async () => {
    await board.drop([imageFile('photo-400x300.png')]);

    // The board goes away while the picture is still on its way: the only thing that may be written
    // afterwards is the fact that it was given up on, which is nothing at all.
    board.view.unmount();

    expect(upload(0).aborts).toBe(1);
    const left = imageSnapshotsOf(board.doc);
    expect(left).toHaveLength(1);
    expect(left[0]!.status).toBe('uploading');
    expect(left[0]!.assetKey).toBeNull();
  });
});

describe('adding pictures from the toolbar', () => {
  let board: BoardWithPictures;

  beforeEach(async () => {
    forgetProviders();
    forgetUploads();
    installImageBitmapStub();
    board = await mountImageBoard();
  });

  /** The picker the browser would have opened, as far as jsdom can show one. */
  function picker(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>('input[data-image-picker]');
    if (input === null) {
      throw new Error('no file picker has been offered');
    }
    return input;
  }

  function openWith(which: 'key' | 'button'): void {
    if (which === 'key') {
      pressKey('i');
      return;
    }
    screen.getByTestId('tool-image').click();
  }

  for (const which of ['key', 'button'] as const) {
    it(`offers the four kinds of picture, from the ${which}`, async () => {
      openWith(which);

      const input = picker();
      expect(input.multiple).toBe(true);
      expect(input.accept.split(',')).toEqual([
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.webp',
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
      ]);
      // Offered as both extensions and types, because a dialog that only knew one of them would either
      // hide files the board can take or offer files it cannot.
      expect(input.accept.split(',')).toHaveLength(9);
    });

    it(`stays in the tool it was in when the ${which} was used`, () => {
      expect(board.tool()).toBe('select');
      openWith(which);
      // The board is still a board: asking for a file is not a mode you can get stuck in.
      expect(board.tool()).toBe('select');
    });
  }

  it('puts what was chosen into the middle of the view, as soon as it was chosen', async () => {
    openWith('button');
    const input = picker();

    const files = [imageFile('one-640x360.png'), imageFile('two-640x360.png')];
    setFiles(input, files);
    await board.settle();

    const images = board.images();
    expect(images).toHaveLength(2);
    const centre = board.worldOf(VIEW_CENTRE);
    // The row, not the individual pictures, is what is centred - so the pair lands where a single one
    // would have, and not twice as far to the right.
    const first = board.place(images[0]!.id);
    const last = board.place(images[1]!.id);
    const rowCentre = (first.x + last.x + last.width) / 2;
    expect(rowCentre).toBeCloseTo(centre.x, 6);
    expect(board.place(images[0]!.id).y + board.place(images[0]!.id).height / 2).toBeCloseTo(centre.y, 6);
    expect(uploads).toHaveLength(2);
  });

  it('lets the same file be chosen twice', async () => {
    openWith('button');
    const input = picker();
    setFiles(input, [imageFile('photo-400x300.png')]);
    await board.settle();
    expect(board.images()).toHaveLength(1);

    // A change event with the same file in it is a second request to add it, and the only way a
    // browser can tell the two apart is by being cleared in between.
    setFiles(input, [imageFile('photo-400x300.png')]);
    await board.settle();
    expect(board.images()).toHaveLength(2);
    expect(uploads).toHaveLength(2);
  });

  it('says nothing when the dialog is closed with nothing chosen', async () => {
    openWith('button');
    const input = picker();
    setFiles(input, []);
    await board.settle();

    expect(board.images()).toEqual([]);
    expect(uploads).toHaveLength(0);
    expect(board.toast()).toBeNull();
  });

  it('refuses the files it will not take, and takes the rest', async () => {
    openWith('button');
    const input = picker();
    setFiles(input, [otherFile('notes.pdf'), imageFile('photo-400x300.png')]);
    await board.settle();

    expect(uploads.map((held) => held.file.name)).toEqual(['photo-400x300.png']);
    expect(board.images()).toHaveLength(1);
    expect(board.toast()).toBe(REJECTION_MESSAGES.type);
  });
});

/** Hand a file input some files, the way a person choosing them would.
 *
 * jsdom has no `DataTransfer`, so there is no `items` to add to and no `drop` to fire: the input's
 * own `change` event is the only way a file can reach a page in jsdom, which happens to also be the
 * way the file picker does it in a browser.
 */
function setFiles(input: HTMLInputElement, files: readonly File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
