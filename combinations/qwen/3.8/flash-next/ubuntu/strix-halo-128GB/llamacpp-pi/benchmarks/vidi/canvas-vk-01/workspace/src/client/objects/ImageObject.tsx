import {
  useCallback,
  useContext,
  useEffect,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { deleteObjects } from '../../shared/board-model';
import { IMAGE_UPLOAD_STALE_MS } from '../../shared/config';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import { useIdentity } from '../board/useIdentity';
import { useUndoController } from '../board/UndoContext';
import { ImageInsertContext } from '../images/useImageInsert';
import type { ObjectProps } from './registry';

/**
 * An image on the board (`image.uploading`, `image.shared`, `image.upload_failure`,
 * `image.unfinished`, `image.unavailable`).
 *
 * What is shown is a function of one thing — the status the model reports at the
 * current time — so a viewer who arrives while the bytes are still travelling sees
 * the same grey box the uploader sees, and every viewer sees the picture the
 * moment `assetKey` arrives, because that is all that was missing.
 *
 * Two of these states are a *reader's* judgement rather than the record's:
 * `unfinished` (an upload that stopped being reported on) and `unavailable` (a
 * stored object that would not load). Neither rewrites the shared doc, because the
 * next reader may be in a better position than this one.
 */

/** What the presentational component needs to know and to be able to ask for. */
export interface ImageObjectProps {
  image: ImageSnap;
  /** True for the client that started this upload — the only one offered Retry. */
  isUploader: boolean;
  /** Fraction of the body sent, uploader's view only. */
  progress?: number;
  /** Whether the bytes are still held for another attempt. */
  canRetry: boolean;
  /** The clock the unfinished state is measured against. */
  now: number;
  onRetry(): void;
  onRemove(): void;
  /** Selection ring, drawn by the board (never by a viewer's judgement). */
  selected?: boolean;
  /** Press that may become a move (`sel.move`, story 7). */
  onObjectPointerDown?(event: ReactPointerEvent<Element>, id: string): void;
  /** False while the board is locked: no button is offered. */
  editable?: boolean;
}

/** Where the assets live; the whole of an image's address is its key. */
export const assetUrl = (assetKey: string): string => `/api/assets/${assetKey}`;

const clamp = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * One image, in whichever state it is in.
 */
export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
  selected = false,
  onObjectPointerDown,
  editable = true,
}: ImageObjectProps): JSX.Element {
  const status = displayStatus(image, now);
  // A picture that fails to load says so for this reader only; a new key (a
  // retry, or the upload landing) deserves another try at loading.
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setUnavailable(false);
  }, [image.assetKey]);

  const box = {
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
  } as const;
  const testId = `image-object-${image.id}`;
  const percent = Math.round(clamp(progress ?? 0) * 100);

  const common = {
    style: box,
    'data-testid': testId,
    'data-status': status,
    'data-selected': selected ? 'true' : 'false',
    onPointerDown: (event: ReactPointerEvent<Element>) => {
      onObjectPointerDown?.(event, image.id);
    },
  } as const;

  if (status === 'ready' && image.assetKey !== null && !unavailable) {
    // The picture itself. `loading=lazy` keeps a board full of images from
    // fetching what is off screen; `decoding=async` keeps a large decode from
    // blocking the frame.
    return (
      <img
        {...common}
        className="image-object image-object-ready"
        src={assetUrl(image.assetKey)}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setUnavailable(true)}
      />
    );
  }

  if (status === 'uploading') {
    // Uploading: the box is already the size the picture will be, so nothing
    // moves when it arrives (`image.uploading`).
    return (
      <div
        {...common}
        className="image-object image-object-uploading"
        role="img"
        aria-label={isUploader ? `Uploading, ${percent} percent` : 'Uploading…'}
        data-progress={String(percent)}
      >
        <div className="image-object-progress" aria-hidden="true">
          <div className="image-object-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="image-object-label" data-testid={`image-progress-${image.id}`}>
          {isUploader ? `${percent}%` : 'Uploading…'}
        </span>
      </div>
    );
  }

  if (status === 'unfinished') {
    // Nobody is reporting on this upload any more: the tab that started it is
    // gone. Anyone can clear it, because it is on everyone's board (`image.unfinished`).
    return (
      <div
        {...common}
        className="image-object image-object-unfinished"
        role="note"
        aria-label="Image upload didn't finish"
      >
        <span className="image-object-label">Image upload didn't finish</span>
        {editable && (
          <button
            type="button"
            className="image-object-button"
            data-testid={`image-remove-${image.id}`}
            aria-label="Remove"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            Remove
          </button>
        )}
      </div>
    );
  }

  if (status === 'failed' && isUploader) {
    return (
      <div
        {...common}
        className="image-object image-object-failed"
        role="note"
        aria-label="Upload failed"
      >
        <span className="image-object-label">Upload failed</span>
        {editable && (
          <div className="image-object-actions">
            {canRetry && (
              <button
                type="button"
                className="image-object-button"
                data-testid={`image-retry-${image.id}`}
                aria-label="Retry"
                onClick={(event) => {
                  event.stopPropagation();
                  onRetry();
                }}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              className="image-object-button"
              data-testid={`image-remove-${image.id}`}
              aria-label="Remove"
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>
    );
  }

  // Failed for anyone else, or a picture that would not load: a box the same
  // size, saying the picture is not there (`image.unavailable`).
  return (
    <div
      {...common}
      className="image-object image-object-unavailable"
      role="note"
      aria-label="Image unavailable"
    >
      <span className="image-object-label">Image unavailable</span>
    </div>
  );
}

/**
 * The object the registry renders.
 *
 * The board hands every object type the same generic props (story 7), so the
 * image-specific facts an image also needs — its upload's progress, whether the
 * bytes are still here to retry, the clock the unfinished state is measured
 * against — come from the insert context this board provides, and the Remove
 * button goes through the shared delete so a removed image detaches any arrow
 * pinned to it.
 */
export function ImageBoardObject({
  obj,
  doc,
  selected,
  editable,
  onObjectPointerDown,
}: ObjectProps): JSX.Element {
  const image = obj as unknown as ImageSnap;
  const insert = useContext(ImageInsertContext);
  const identity = useIdentity();
  const undo = useUndoController();
  const [now, setNow] = useState(() => Date.now());

  // An image only ever becomes more stale than it already is, so the clock is set
  // once: at the moment this one crosses the unfinished line. No polling.
  useEffect(() => {
    if (image.status !== 'uploading') return;
    const remaining = image.uploadStartedAt + IMAGE_UPLOAD_STALE_MS - Date.now();
    if (remaining <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [image.status, image.uploadStartedAt]);

  const remove = useCallback((): void => {
    if (!editable) return;
    undo?.boundary();
    deleteObjects(doc, [image.id]);
    undo?.boundary();
  }, [doc, editable, image.id, undo]);

  return (
    <ImageObject
      image={image}
      isUploader={image.uploaderId === identity.id}
      progress={insert?.progress.get(image.id)}
      canRetry={insert?.canRetry(image.id) ?? false}
      now={now}
      selected={selected}
      editable={editable}
      onObjectPointerDown={onObjectPointerDown}
      onRetry={() => insert?.retry(image.id)}
      onRemove={remove}
    />
  );
}
