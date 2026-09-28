// The image component's visible states (TC-21 to TC-24). The presentation is tested
// directly - given one image, who is looking, the progress and the clock, it must show
// exactly one of the five states with the product's own words and buttons. Then the
// registry container is tested with a real doc and context, because two of its jobs -
// "Retry re-uploads" and "Remove deletes" - are actions, not looks.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ImageObject, ImageObjectView } from '../../src/client/objects/ImageObject.tsx';
import { ImageInsertContext, type ImageInsertValue } from '../../src/client/images/ImageInsertContext.ts';
import { UndoContext } from '../../src/client/board/useUndo.ts';
import type { UndoController } from '../../src/client/board/undo.ts';
import { objectsSnapshot } from '../../src/shared/board-model.ts';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config.ts';
import { localIdentityId } from '../../src/client/board/localIdentity.ts';
import type { ImageSnap } from '../../src/shared/objects/image.ts';

const ID = 'img-1';
const KEY = 'abcdefghij0123456789AB/ABCDEFGHIJ0123456789AB';

function snap(over: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: ID,
    type: 'image',
    x: 10,
    y: 20,
    width: 200,
    height: 100,
    z: 1,
    createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 200,
    naturalHeight: 100,
    status: 'uploading',
    uploadStartedAt: 1000,
    uploaderId: 'me',
    ...over,
  } as ImageSnap;
}

describe('ImageObject: uploading and ready (TC-21)', () => {
  it('shows the uploader a percentage and everyone else a plain Uploading', () => {
    const { rerender } = render(
      <ImageObject image={snap({ status: 'uploading' })} isUploader progress={0.4} canRetry={false} now={1500} onRetry={() => {}} onRemove={() => {}} />,
    );
    expect(screen.getByTestId(`image-uploading-${ID}`).textContent).toBe('40%');

    // the very same image, seen by someone who did not upload it: no percentage,
    // because progress is the uploader's own screen only (image.uploading).
    rerender(
      <ImageObject image={snap({ status: 'uploading' })} isUploader={false} canRetry={false} now={1500} onRetry={() => {}} onRemove={() => {}} />,
    );
    expect(screen.getByTestId(`image-uploading-${ID}`).textContent).toBe('Uploading…');
  });

  it('shows a ready image as a real <img> at the asset address', () => {
    render(
      <ImageObject image={snap({ status: 'ready', assetKey: KEY })} isUploader canRetry={false} now={1500} onRetry={() => {}} onRemove={() => {}} />,
    );
    const img = screen.getByTestId(`image-bit-${ID}`) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe(`/api/assets/${KEY}`);
    expect(img.getAttribute('alt')).toBe('Image');
  });
});

describe('ImageObject: failed (TC-21)', () => {
  it('offers the uploader Retry and Remove', () => {
    render(
      <ImageObject image={snap({ status: 'failed' })} isUploader canRetry now={1500} onRetry={() => {}} onRemove={() => {}} />,
    );
    expect(screen.getByTestId(`image-state-${ID}`)).toHaveAttribute('data-image-status', 'failed');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('shows everyone else only "Image unavailable"', () => {
    render(
      <ImageObject image={snap({ status: 'failed' })} isUploader={false} canRetry={false} now={1500} onRetry={() => {}} onRemove={() => {}} />,
    );
    expect(screen.getByTestId(`image-state-${ID}`).textContent).toBe('Image unavailable');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});

describe('ImageObject: unfinished (TC-22)', () => {
  it('shows "Image upload didn\'t finish" with a Remove anyone can use', () => {
    render(
      <ImageObject image={snap({ status: 'uploading', uploadStartedAt: 0 })} isUploader={false} canRetry={false} now={IMAGE_UPLOAD_STALE_MS + 5000} onRetry={() => {}} onRemove={() => {}} />,
    );
    expect(screen.getByTestId(`image-state-${ID}`)).toHaveAttribute('data-image-status', 'unfinished');
    expect(screen.getByTestId(`image-state-${ID}`).textContent).toContain("Image upload didn't finish");
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('Remove calls onRemove', () => {
    const onRemove = vi.fn();
    render(
      <ImageObject image={snap({ status: 'uploading', uploadStartedAt: 0 })} isUploader={false} canRetry={false} now={IMAGE_UPLOAD_STALE_MS + 5000} onRetry={() => {}} onRemove={onRemove} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe('ImageObject: a ready image that will not load (TC-23)', () => {
  it('degrades to "Image unavailable" when the bytes error', () => {
    render(
      <ImageObject image={snap({ status: 'ready', assetKey: KEY })} isUploader canRetry={false} now={1500} onRetry={() => {}} onRemove={() => {}} />,
    );
    const img = screen.getByTestId(`image-bit-${ID}`);
    fireEvent.error(img);
    expect(screen.getByTestId(`image-state-${ID}`)).toHaveAttribute('data-image-status', 'unavailable');
    expect(screen.getByTestId(`image-state-${ID}`).textContent).toBe('Image unavailable');
  });
});

describe('ImageObject: retry affordances (TC-24)', () => {
  it('clicking Retry calls onRetry', () => {
    const onRetry = vi.fn();
    render(
      <ImageObject image={snap({ status: 'failed' })} isUploader canRetry now={1500} onRetry={onRetry} onRemove={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('hides Retry and keeps only Remove when the file is gone (after a reload)', () => {
    // canRetry is false exactly when the File was lost - a page reload - so a person
    // is not offered a retry the app cannot perform (images.retry).
    render(
      <ImageObject image={snap({ status: 'failed' })} isUploader canRetry={false} now={1500} onRetry={() => {}} onRemove={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});

// --- the registry container: the two actions that change the doc -------------------

const undo = { boundary: () => {} } as unknown as UndoController;

function value(over: Partial<ImageInsertValue> = {}): ImageInsertValue {
  return {
    progress: () => undefined,
    canRetry: () => false,
    isRetrying: () => false,
    retry: () => {},
    remove: () => {},
    ...over,
  };
}

function mountContainer(doc: Y.Doc, obj: ImageSnap, insert: ImageInsertValue) {
  const onObjectPointerDown = vi.fn();
  return render(
    <UndoContext.Provider value={undo}>
      <ImageInsertContext.Provider value={insert}>
        <ImageObjectView
          obj={obj}
          doc={doc}
          zoom={1}
          selected={false}
          editing={false}
          editable
          onObjectPointerDown={onObjectPointerDown}
          onStartEdit={() => {}}
          onEndEdit={() => {}}
          onColor={() => {}}
        />
      </ImageInsertContext.Provider>
    </UndoContext.Provider>,
  );
}

describe('ImageObjectView: container actions', () => {
  it('a failed image the uploader is still holding shows Retry; reload shows only Remove (TC-24)', () => {
    const doc = new Y.Doc();
    const obj = snap({ status: 'failed', uploaderId: localIdentityId() });

    // File still in memory: the context says it can be retried.
    const withFile = mountContainer(doc, obj, value({ canRetry: () => true, retry: vi.fn() }));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    withFile.unmount();

    // After a simulated reload the File is gone, so canRetry is false: only Remove.
    mountContainer(doc, obj, value({ canRetry: () => false }));
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('Remove deletes the object from the doc', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(snap({ status: 'failed', uploaderId: localIdentityId() }))) {
      if (v !== undefined) m.set(k, v);
    }
    objects.set(ID, m);

    mountContainer(doc, snap({ status: 'failed', uploaderId: localIdentityId() }), value());
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    // it went through the real delete (deleteObjects), not just a callback
    expect(objectsSnapshot(doc).find((o) => o.id === ID)).toBeUndefined();
  });
});
