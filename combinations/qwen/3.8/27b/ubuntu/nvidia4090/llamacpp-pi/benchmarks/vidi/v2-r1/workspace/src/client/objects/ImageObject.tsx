// ImageObject (story 12, image.render): renders one image object in its
// display state (image.render, image.unfinished, image.load_failure):
//
//  - uploading + this client: grey box of final size, image icon, progress
//    bar with the percentage;
//  - uploading + another client: the same box with "Uploading…";
//  - failed + this client: "Upload failed" with Retry (while the file is
//    still in memory) and Remove;
//  - failed + another client / image that cannot load: "Image unavailable"
//    box of the same size;
//  - unfinished (uploading older than the stale window, anyone): "Image
//    upload didn't finish" with Remove.
//
// Board integration (selection, gestures) comes from the registry adapter:
// `onPointerDown` (optional) delegates a press to the generic transform
// gesture; the component renders in world coordinates like the other
// objects.

import { useEffect, useState, type JSX } from 'react';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import type { ObjectPointerEvent } from './registry';

export interface ImageObjectProps {
  image: ImageSnap;
  /** True when this client started the upload (sees progress and Retry). */
  isUploader: boolean;
  /** Upload progress 0..1 while uploading (uploader only). */
  progress?: number;
  /** True while the in-memory file allows Retry. */
  canRetry: boolean;
  /** Current time (drives the unfinished derivation). */
  now: number;
  onRetry(): void;
  onRemove(): void;
  // --- optional board integration (the registry adapter passes these) -----
  selected?: boolean;
  /** Camera zoom (screen px per world unit); 1 in isolation. */
  zoom?: number;
  /** Edit lock (story 4): removes are no-ops on a locked board. */
  canEdit?: boolean;
  onPointerDown?: (e: ObjectPointerEvent, id: string) => void;
}

/** The asset URL for a stored image (the worker serves /api/assets/…). */
export function assetUrl(assetKey: string): string {
  return `/api/assets/${assetKey}`;
}

function BrokenIcon(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="#9aa0a6" strokeWidth="1.5" />
      <path d="M3 15l5-5 4 4 3-3 6 6" stroke="#9aa0a6" strokeWidth="1.5" />
      <path d="M17 4l4 4M21 4l-4 4" stroke="#d93025" strokeWidth="1.5" />
    </svg>
  );
}

function ImageIcon(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="#9aa0a6" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="1.8" fill="#9aa0a6" />
      <path d="M4 18l6-6 4 4 3-3 3 3" stroke="#9aa0a6" strokeWidth="1.5" />
    </svg>
  );
}

export function ImageObject(props: ImageObjectProps): JSX.Element | null {
  const {
    image,
    isUploader,
    progress,
    canRetry,
    now,
    onRetry,
    onRemove,
    selected = false,
    canEdit = true,
    onPointerDown,
  } = props;

  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    setLoadFailed(false);
  }, [image.assetKey]);

  const w = image.width ?? 0;
  const h = image.height ?? 0;
  const status = displayStatus(image, now);
  const unavailable = status === 'ready' && (image.assetKey === null || loadFailed);

  const onBoxPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    if (onPointerDown === undefined) return;
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore: best-effort (jsdom).
      }
    }
    onPointerDown(e, image.id);
  };

  const stop = (e: React.PointerEvent): void => e.stopPropagation();

  let inner: JSX.Element;
  switch (status) {
    case 'uploading':
      if (isUploader) {
        const pct = Math.round((progress ?? 0) * 100);
        inner = (
          <div className="image-object__placeholder" data-testid="image-placeholder">
            <ImageIcon />
            <div
              className="image-object__progressbar"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              data-testid="image-progress"
            >
              <div
                className="image-object__progressfill"
                style={{ width: `${pct}%` }}
              />
              <span className="image-object__percent" data-testid="image-percent">
                {pct}%
              </span>
            </div>
          </div>
        );
      } else {
        inner = (
          <div className="image-object__placeholder" data-testid="image-placeholder">
            <ImageIcon />
            <span data-testid="image-uploading-label">Uploading…</span>
          </div>
        );
      }
      break;
    case 'failed':
      if (isUploader) {
        inner = (
          <div className="image-object__failed" data-testid="image-failed">
            <BrokenIcon />
            <span>Upload failed</span>
            <span className="image-object__actions">
              {canRetry && (
                <button
                  type="button"
                  className="image-object__button"
                  aria-label="Retry upload"
                  data-testid="image-retry"
                  onPointerDown={stop}
                  onClick={() => onRetry()}
                >
                  Retry
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="image-object__button image-object__button--danger"
                  aria-label="Remove image"
                  data-testid="image-remove"
                  onPointerDown={stop}
                  onClick={() => onRemove()}
                >
                  Remove
                </button>
              )}
            </span>
          </div>
        );
      } else {
        inner = (
          <div className="image-object__unavailable" data-testid="image-unavailable">
            <BrokenIcon />
            <span>Image unavailable</span>
          </div>
        );
      }
      break;
    case 'unfinished':
      inner = (
        <div className="image-object__unfinished" data-testid="image-unfinished">
          <BrokenIcon />
          <span>Image upload didn't finish</span>
          {canEdit && (
            <button
              type="button"
              className="image-object__button image-object__button--danger"
              aria-label="Remove image"
              data-testid="image-remove"
              onPointerDown={stop}
              onClick={() => onRemove()}
            >
              Remove
            </button>
          )}
        </div>
      );
      break;
    default:
      if (unavailable) {
        inner = (
          <div className="image-object__unavailable" data-testid="image-unavailable">
            <BrokenIcon />
            <span>Image unavailable</span>
          </div>
        );
      } else {
        inner = (
          <img
            data-testid="image-img"
            src={assetUrl(image.assetKey!)}
            alt="Image"
            draggable={false}
            decoding="async"
            loading="lazy"
            onError={() => setLoadFailed(true)}
          />
        );
      }
  }

  return (
    <div
      className={[
        'image-object',
        `image-object--${status}`,
        selected ? 'image-object--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="image-object"
      data-id={image.id}
      data-status={status}
      data-selected={selected || undefined}
      onPointerDown={onBoxPointerDown}
      style={{
        left: image.x,
        top: image.y,
        width: w,
        height: h,
        zIndex: image.z,
      }}
    >
      {inner}
    </div>
  );
}
