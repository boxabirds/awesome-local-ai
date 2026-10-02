/// <reference types="vitest" />
// Story 12, image.object: what a board says about a picture whose bytes are not on
// the board.
//
// The document holds one object and one status. What it cannot hold is which of the
// two people reading it the upload belongs to — that is a fact about this tab, right
// now, and a document that stored it would be a document that lied the moment that
// tab reloaded. So everything below is built around one prop, `canRetry`, which means
// *this tab is holding the file*, and which is the whole of the difference between
// "Uploading… 63 %" and "Uploading…", and between "Upload failed" with two buttons
// and "Image unavailable" with one.
//
// `now` is passed rather than watched here for the same reason: `unfinished` is a
// statement about time, and a test that let the clock decide would be a test that
// sometimes passes.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ImageObject } from '../../src/client/objects/ImageObject';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { createSticky, deleteObjects, snapshotAll } from '../../src/shared/board-model';
import { IMAGE_STATUS_TEXT, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { assetPath } from '../../src/shared/routes';

const NOW = 1_700_000_000_000;
const KEY = 'boardBoardBoardBoard1/assetAssetAsset1';

/** The box the picture was placed at, and the ratio the file came with: 400x300 for
 *  an 800x600 file, which is the same shape at half the size. */
const ITEM = {
  rect: { x: 100, y: -200, width: 400, height: 300 },
  naturalWidth: 800,
  naturalHeight: 600,
  contentType: 'image/png',
};

interface View {
  doc: Y.Doc;
  /** The object's id, which the document makes up. */
  id: string;
  /** The picture as the document holds it right now. */
  image(): ImageSnap;
  retries: string[];
  removals: string[];
  selections: string[];
  /** Paint this picture again, as this board now sees it. */
  repaint(): void;
  /** This tab closes: its screen is gone, the document is not. */
  unmount(): void;
}

interface Options {
  status?: 'uploading' | 'ready' | 'failed';
  /** Whether *this tab* is the one holding the file. */
  uploader?: boolean;
  startedAt?: number;
  now?: number;
  progress?: number;
}

/** One person's board, looking at one picture. */
function shown(options: Options = {}): View {
  const doc = new Y.Doc();
  const [id] = createImagePlaceholders(doc, [ITEM], 'uploader-one', options.startedAt ?? NOW);
  const pictureId = id!;
  if (options.status === 'failed') markImageFailed(doc, pictureId);
  if (options.status === 'ready') markImageReady(doc, pictureId, KEY);

  const retries: string[] = [];
  const removals: string[] = [];
  const selections: string[] = [];

  const element = () => (
    <ImageObject
      object={read(doc, pictureId)}
      doc={doc}
      zoom={1}
      selected={false}
      canRetry={options.uploader === true}
      now={options.now ?? NOW}
      progress={options.progress}
      onSelect={(picked) => selections.push(picked)}
      onRetry={(retry) => retries.push(retry)}
      onRemove={(gone) => {
        removals.push(gone);
        // The same delete the Delete key performs, from a button: story 7's
        // machinery, not a picture-shaped copy of it.
        deleteObjects(doc, [gone]);
      }}
    />
  );

  const view = render(element());

  return {
    doc,
    id: pictureId,
    image: () => read(doc, pictureId),
    retries,
    removals,
    selections,
    repaint: () => {
      // The same component, painted again with what the document says now — which is
      // what a clock tick or a completion does to a picture already on the screen.
      view.rerender(element());
    },
    unmount: () => {
      view.unmount();
    },
  };
}

/** The picture as the document holds it right now. */
function read(doc: Y.Doc, id: string): ImageSnap {
  const found = snapshotAll(doc).find((object) => object.id === id);
  if (found === undefined) throw new Error('there is no picture on this board');
  return found as ImageSnap;
}

/** The box, as the screen reports it. */
function box(): Record<string, string | null> {
  const element = screen.getByTestId('image-object');
  return {
    'data-box-x': element.getAttribute('data-box-x'),
    'data-box-y': element.getAttribute('data-box-y'),
    'data-box-width': element.getAttribute('data-box-width'),
    'data-box-height': element.getAttribute('data-box-height'),
  };
}

const stale = NOW - IMAGE_UPLOAD_STALE_MS - 1_000;
const almost = NOW - IMAGE_UPLOAD_STALE_MS + 60_000;

describe('TC-21: one failed upload, and the two sentences it is said as', () => {
  it('the person whose upload failed is told it failed, and given something to do about it', () => {
    const board = shown({ status: 'failed', uploader: true });

    expect(screen.getByTestId('image-failed')).toHaveTextContent(IMAGE_STATUS_TEXT.failed);
    expect(screen.getByTestId('image-retry')).toHaveTextContent('Retry');
    expect(screen.getByTestId('image-remove')).toHaveTextContent('Remove');
    expect(screen.getByTestId('image-object').getAttribute('data-display')).toBe('failed');
    expect(screen.queryByTestId('image-img')).toBeNull();
    expect(board.image().status).toBe('failed');
    expect(board.image().assetKey).toBeNull();
  });

  it('everybody else is told the picture is not there, and given no button that would lie', () => {
    const board = shown({ status: 'failed', uploader: false });

    expect(screen.getByTestId('image-unavailable')).toHaveTextContent(IMAGE_STATUS_TEXT.unavailable);
    // There is nothing for them to retry: the file is on somebody else's computer.
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.queryByTestId('image-failed')).toBeNull();
    // Taking it off the board is always something, and does not depend on anybody's
    // bytes, so it is the one control left.
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
    expect(board.image().status).toBe('failed');
  });

  it('the two of them are looking at one document and at two screens', () => {
    const uploader = shown({ status: 'failed', uploader: true });
    expect(screen.getByTestId('image-failed')).toBeInTheDocument();
    const before = uploader.image();
    uploader.unmount();

    // A second tab which never had the file. Nothing was written between these two
    // renders: only who is holding the mouse is different.
    const other = shown({ status: 'failed', uploader: false });
    expect(screen.queryByTestId('image-failed')).toBeNull();
    expect(screen.getByTestId('image-unavailable')).toBeInTheDocument();
    expect(other.image().status).toBe(before.status);
    expect(other.image().width).toBe(before.width);
  });

  it('a picture is a picture to the keyboard: it has a name, and no text to edit', () => {
    shown({ status: 'ready', uploader: false });

    expect(screen.getByRole('group', { name: 'Image' })).toBeInTheDocument();
    expect(screen.getByTestId('image-img')).toHaveAttribute('alt', 'Image');
    expect(document.querySelector('textarea')).toBeNull();
  });
});

describe('TC-22: an upload whose tab stopped answering for it', () => {
  it('after five minutes of silence everybody is told it did not finish', () => {
    shown({ status: 'uploading', uploader: false, startedAt: stale, now: NOW });

    expect(screen.getByTestId('image-unavailable')).toHaveTextContent(IMAGE_STATUS_TEXT.unfinished);
    expect(screen.getByTestId('image-object').getAttribute('data-display')).toBe('unfinished');
    // The document still says uploading, because nobody wrote anything: this line is
    // read off the clock, which is the only way a fact about time can be true.
    expect(screen.getByTestId('image-object').getAttribute('data-status')).toBe('uploading');
    // No bar: a bar is a fact about a transfer, and there is no transfer to measure.
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('Uploading…')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
  });

  it('Remove takes the unfinished picture off the board, for whoever is left', () => {
    const board = shown({ status: 'uploading', uploader: false, startedAt: stale, now: NOW });

    fireEvent.click(screen.getByTestId('image-remove'));

    expect(board.removals).toEqual([board.id]);
    expect(snapshotAll(board.doc)).toEqual([]);
    // The entry is gone from the document, which is the only place a board keeps a
    // picture: this tab's box will not be painted again, and no other board will
    // paint it either.
    expect(board.doc.getMap('objects').has(board.id)).toBe(false);
  });

  it('a minute short of the limit, it is still an upload', () => {
    shown({ status: 'uploading', uploader: true, startedAt: almost, now: NOW, progress: 0.45 });

    expect(screen.getByTestId('image-object').getAttribute('data-display')).toBe('uploading');
    expect(screen.getByTestId('image-uploading-mine')).toHaveAttribute('aria-valuenow', '45');
    expect(screen.queryByTestId('image-unavailable')).toBeNull();
  });

  it('the sentence about an abandoned upload is the same for every person looking', () => {
    // The uploader's own tab, six minutes after it stopped hearing about the upload —
    // which is what a laptop lid is. `displayStatus` does not know who is asking, and
    // the screen is not built on the idea that it does.
    shown({ status: 'uploading', uploader: true, startedAt: stale, now: NOW, progress: 0.45 });

    expect(screen.getByTestId('image-unavailable')).toHaveTextContent(IMAGE_STATUS_TEXT.unfinished);
    // A Retry would be a promise about a transfer this tab is not making.
    expect(screen.queryByTestId('image-retry')).toBeNull();
  });
});

describe('TC-23: a stored picture that will not load', () => {
  it('a broken picture becomes a box of the same size, in the same place', () => {
    const board = shown({ status: 'ready', uploader: false });
    const before = box();
    expect(screen.getByTestId('image-img')).toHaveAttribute('src', assetPath(KEY));

    fireEvent.error(screen.getByTestId('image-img'));

    expect(screen.getByTestId('image-unavailable')).toHaveTextContent(IMAGE_STATUS_TEXT.unavailable);
    expect(box()).toEqual(before);
    expect(before).toEqual({
      'data-box-x': '100',
      'data-box-y': '-200',
      'data-box-width': '400',
      'data-box-height': '300',
    });
    expect(screen.queryByTestId('image-img')).toBeNull();
    // The store is not what is wrong: the object still says the bytes are there, and
    // a board that wrote otherwise would be a board deleting a picture because one
    // request failed.
    expect(board.image().status).toBe('ready');
    expect(board.image().assetKey).toBe(KEY);
  });

  it('a broken picture is offered no Retry, because there is no file here to send', () => {
    shown({ status: 'ready', uploader: true });

    fireEvent.error(screen.getByTestId('image-img'));

    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
  });

  it('a box that cannot be read is still an object on the board', () => {
    const board = shown({ status: 'ready', uploader: false });
    fireEvent.error(screen.getByTestId('image-img'));

    const element = screen.getByTestId('image-object');
    fireEvent.pointerDown(element, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(element, { pointerId: 1 });

    expect(board.selections).toEqual([board.id]);
  });

  it('a picture that comes back is painted again', () => {
    const board = shown({ status: 'ready', uploader: true });
    fireEvent.error(screen.getByTestId('image-img'));
    expect(screen.getByTestId('image-unavailable')).toBeInTheDocument();

    // A retry that worked: the object keeps its box and gets a new address, and what
    // went wrong with the last picture is not evidence about this one.
    const fresh = 'boardBoardBoardBoard1/anotherAnother1';
    markImageReady(board.doc, board.id, fresh);
    board.repaint();

    expect(screen.getByTestId('image-img')).toHaveAttribute('src', assetPath(fresh));
    expect(screen.queryByTestId('image-unavailable')).toBeNull();
  });

  it('one picture that will not load leaves the rest of the board alone', () => {
    const doc = new Y.Doc();
    const [pictureId] = createImagePlaceholders(doc, [ITEM], 'uploader-one', NOW);
    markImageReady(doc, pictureId!, KEY);
    const note = createSticky(doc, { x: -400, y: 0 });

    render(
      <ImageObject
        object={read(doc, pictureId!)}
        doc={doc}
        zoom={1}
        selected={false}
        canRetry={false}
        now={NOW}
        onSelect={() => {}}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );
    fireEvent.error(screen.getByTestId('image-img'));

    // A picture that will not load is one object's bad luck, not an error boundary's
    // business: the note is still on the board, and so is the picture's own box.
    expect(snapshotAll(doc).map((object) => object.type).sort()).toEqual(['image', 'sticky']);
    expect(snapshotAll(doc).find((object) => object.id === note)).toBeDefined();
    expect(screen.getByTestId('image-object')).toBeInTheDocument();
  });
});

describe('TC-24: sending the same file up again', () => {
  it('Retry is a button on the failure, for the tab that has the file', () => {
    const board = shown({ status: 'failed', uploader: true });

    fireEvent.click(screen.getByTestId('image-retry'));

    expect(board.retries).toEqual([board.id]);
    // Aiming at Retry is not aiming at the picture: it does not select it.
    expect(board.selections).toEqual([]);
  });

  it('a retry goes back to uploading, in the document and on the screen', () => {
    const board = shown({ status: 'failed', uploader: true });
    fireEvent.click(screen.getByTestId('image-retry'));

    // What the insert flow does with the file it is still holding.
    markImageRetrying(board.doc, board.id, NOW + 1_000);
    board.repaint();

    expect(board.image().status).toBe('uploading');
    expect(screen.getByTestId('image-object').getAttribute('data-display')).toBe('uploading');
    expect(screen.queryByTestId('image-failed')).toBeNull();
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-uploading-mine')).toBeInTheDocument();
  });

  it('after a reload there is no Retry, only Remove', () => {
    // The tab that reloaded is the tab that lost the file. It is now exactly as
    // uninformed as everybody else, and it is drawn the same way on purpose.
    const board = shown({ status: 'failed', uploader: false });

    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-unavailable')).toHaveTextContent(IMAGE_STATUS_TEXT.unavailable);

    fireEvent.click(screen.getByTestId('image-remove'));
    expect(snapshotAll(board.doc)).toEqual([]);
  });

  it('Remove on a failed picture is the Delete key, not a second way to delete', () => {
    const board = shown({ status: 'failed', uploader: true });

    fireEvent.click(screen.getByTestId('image-remove'));

    expect(board.removals).toEqual([board.id]);
    expect(board.retries).toEqual([]);
    expect(snapshotAll(board.doc)).toEqual([]);
  });

  it('carries its own names as separate class names', () => {
    // A stylesheet is not loaded here: jsdom will happily render a class attribute of
    // "image-objectimage-object-failed" and every box will measure nothing and no test
    // will notice. Which is exactly what one of them did, in a real browser, where a
    // picture whose classes had run together was a picture that was not positioned,
    // not clickable, and not drawn. So the names are checked to be names, in the one
    // place that a test runs without a browser.
    const board = shown({ status: 'failed', uploader: true });

    const names = screen.getByTestId('image-object').className.split(' ');
    expect(names).toContain('image-object');
    expect(names).toContain('image-object-failed');
    expect(names).toContain('is-mine');
    expect(names).not.toContain('');
  });

  it('does not carry the name of a tab that is not holding the file', () => {
    shown({ status: 'failed', uploader: false });

    expect(screen.getByTestId('image-object').className.split(' ')).not.toContain('is-mine');
  });
});
