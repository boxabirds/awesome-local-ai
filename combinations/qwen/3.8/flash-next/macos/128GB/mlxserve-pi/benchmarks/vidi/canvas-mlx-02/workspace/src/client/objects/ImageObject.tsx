// An image on the board (story 12, design `image.object`). There are two pieces in
// this file and the split is the point:
//
//   * `ImageObject` is the PRESENTATION: given one image, whether the viewer is the
//     one who uploaded it, the upload progress, and the clock, it draws exactly one
//     of five states - uploading (with the uploader's own progress bar), ready (the
//     picture), failed (Retry/Remove for the uploader, "unavailable" for everyone
//     else), unfinished (a stale upload anyone can remove), and a ready image whose
//     file would not load. It owns selection, dragging and resizing nothing.
//
//   * `ImageObjectView` is what the registry registers: the ordinary board object
//     `ImageObject` sits inside. It reads the live progress / retry / remove out of
//     the `ImageInsertContext` and the uploader-only "can I retry" from there too,
//     and it keeps a clock so an upload that never finished eventually repaints as
//     unfinished. It also wires the one behaviour an image has that the picture
//     cannot carry: a broken file that fails to load shows "unavailable" at exactly
//     the size the box already is.
import { useCallback, useContext, useEffect, useReducer, useState } from 'react';
import type React from 'react';
import {
  displayStatus,
  isImageSnapshot,
  type ImageSnap,
} from '../../shared/objects/image.ts';
import { IMAGE_UPLOAD_TICK_MS, IMAGE_MIN_SIZE_WORLD } from '../../shared/config.ts';
import { deleteObjects } from '../../shared/board-model.ts';
import { UndoContext } from '../board/useUndo.ts';
import { localIdentityId } from '../board/localIdentity.ts';
import { ImageInsertContext } from '../images/ImageInsertContext.ts';
import type { ObjectProps } from './registry.tsx';

const UNAVAILABLE = 'Image unavailable';

/** A progress fraction as the whole-number percentage a person reads. */
function percent(fraction: number): string {
  return `${Math.max(0, Math.min(100, Math.round(fraction * 100)))}%`;
}

/**
 * The presentational image: every visible state of one image object, decided only by
 * what it is handed. `progress` is present only for the uploader; `canRetry` says
 * whether a retry is possible (the File is still held); `now` is the clock the
 * unfinished boundary is measured against; `onRetry` and `onRemove` are the two
 * actions the failure states offer.
 */
export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
}: {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}): React.JSX.Element {
  const status = displayStatus(image, now);
  // A ready image whose bytes will not load (a missing or corrupt asset) degrades to
  // the same "unavailable" a stranger sees for a failure - but only at render time,
  // and it never propagates the error anywhere (image.unavailable).
  const [loadFailed, setLoadFailed] = useState(false);
  const key = image.assetKey;
  useEffect(() => {
    setLoadFailed(false);
  }, [key]);

  const box: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  if (status === 'ready' && key && !loadFailed) {
    return (
      <div data-testid={`image-state-${image.id}`} data-image-status="ready" style={box}>
        <img
          data-testid={`image-bit-${image.id}`}
          src={`/api/assets/${key}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setLoadFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
        />
      </div>
    );
  }

  if (status === 'ready') {
    // The bytes were there and would not decode - the same message the uploader's
    // failure shows to everyone else, and the same box size (image.unavailable).
    return (
      <div data-testid={`image-state-${image.id}`} data-image-status="unavailable" style={{ ...box, background: '#eeeeee', color: '#666666', fontSize: 13 }}>
        {UNAVAILABLE}
      </div>
    );
  }

  if (status === 'uploading') {
    const showProgress = isUploader && progress !== undefined;
    return (
      <div
        data-testid={`image-state-${image.id}`}
        data-image-status="uploading"
        style={{ ...box, background: '#e0e0e0', color: '#555555', fontSize: 13 }}
      >
        <span data-testid={`image-uploading-${image.id}`}>
          {showProgress ? percent(progress as number) : 'Uploading…'}
        </span>
      </div>
    );
  }

  if (status === 'failed') {
    if (!isUploader) {
      // A stranger cannot retry or remove somebody else's half-image; they just see
      // that it is not available.
      return (
        <div data-testid={`image-state-${image.id}`} data-image-status="failed" style={{ ...box, background: '#eeeeee', color: '#666666', fontSize: 13 }}>
          {UNAVAILABLE}
        </div>
      );
    }
    return (
      <div
        data-testid={`image-state-${image.id}`}
        data-image-status="failed"
        style={{ ...box, flexDirection: 'column', gap: 6, background: '#f6e7e7', color: '#8a2b2b', fontSize: 13 }}
      >
        <span>Upload failed</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {canRetry ? (
            <button type="button" aria-label="Retry" data-testid={`image-retry-${image.id}`} onClick={onRetry} style={buttonStyle}>
              Retry
            </button>
          ) : null}
          <button type="button" aria-label="Remove" data-testid={`image-remove-${image.id}`} onClick={onRemove} style={buttonStyle}>
            Remove
          </button>
        </span>
      </div>
    );
  }

  // 'unfinished': the upload stopped reporting (a tab that closed mid-send). Anyone
  // may clear it away.
  return (
    <div
      data-testid={`image-state-${image.id}`}
      data-image-status="unfinished"
      style={{ ...box, flexDirection: 'column', gap: 6, background: '#eee', color: '#666666', fontSize: 13 }}
    >
      <span>Image upload didn&apos;t finish</span>
      <button type="button" aria-label="Remove" data-testid={`image-remove-${image.id}`} onClick={onRemove} style={buttonStyle}>
        Remove
      </button>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid #bbb',
  background: '#fff',
  borderRadius: 6,
  padding: '2px 8px',
  fontSize: 12,
  cursor: 'pointer',
};

/**
 * A wall clock that ticks only while this image is still `uploading`, so an upload
 * that never finished crosses the stale boundary and repaints as `unfinished`
 * without a write or a poll when it is not needed (image.unfinished).
 */
function useUploadingClock(uploading: boolean): number {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!uploading) return;
    const timer = setInterval(tick, IMAGE_UPLOAD_TICK_MS);
    return () => clearInterval(timer);
  }, [uploading]);
  return Date.now();
}

/**
 * The registry component: the positioned board object `ImageObject` fills. All of
 * selection, moving, resizing, marquee, delete and undo come from story 7 through
 * the registry entry - this adds only the image's own look and its two actions.
 */
export function ImageObjectView(props: ObjectProps): React.JSX.Element {
  const { obj, doc, selected, editable, onObjectPointerDown } = props;
  const insert = useContext(ImageInsertContext);
  const undo = useContext(UndoContext);
  const isImage = isImageSnapshot(obj);
  const image = isImage ? obj : null;

  const uploading = image?.status === 'uploading';
  const now = useUploadingClock(uploading === true);

  // Remove goes through story 7's delete, wrapped in a step boundary so "an image
  // was removed" is its own undo step, exactly like any other deletion. The
  // selection prunes itself once the object is gone (useSelection).
  const onRemove = useCallback(() => {
    if (!undo) return;
    undo.boundary();
    deleteObjects(doc, [obj.id]);
    undo.boundary();
  }, [undo, doc, obj.id]);

  const onRetry = useCallback(() => {
    insert?.retry(obj.id);
  }, [insert, obj.id]);

  if (!image) {
    // Not a readable image: draw an empty, inert box so one broken object cannot
    // take the board down (the same rule every object type follows).
    return (
      <div
        data-testid={`image-${obj.id}`}
        data-object-id={obj.id}
        data-broken="true"
        style={{ position: 'absolute', left: obj.x, top: obj.y, width: 0, height: 0, pointerEvents: 'none' }}
      />
    );
  }

  const width = finiteOr(image.width, IMAGE_MIN_SIZE_WORLD);
  const height = finiteOr(image.height, IMAGE_MIN_SIZE_WORLD);
  const isUploader = image.uploaderId === localIdentityId();
  const progress = insert?.progress(obj.id);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !editable) return;
    e.stopPropagation();
    onObjectPointerDown(e, obj.id);
  };

  return (
    <div
      role="group"
      aria-label="Image"
      data-testid={`image-${obj.id}`}
      data-object-id={obj.id}
      data-selected={selected}
      data-editable={editable}
      data-image-status={displayStatus(image, now)}
      data-uploader={isUploader}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        boxSizing: 'border-box',
        cursor: editable ? 'move' : 'default',
        touchAction: 'none',
        pointerEvents: 'auto',
        // A live zoom would blur the picture; the object's world box is what it is.
        outline: selected ? '2px solid #2563eb' : 'none',
      }}
      onPointerDown={onPointerDown}
    >
      <ImageObject
        image={image}
        isUploader={isUploader}
        progress={isUploader ? progress : undefined}
        canRetry={insert?.canRetry(obj.id) ?? false}
        now={now}
        onRetry={onRetry}
        onRemove={onRemove}
      />
    </div>
  );
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
