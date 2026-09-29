// Story 12: one image (anchor: image.object).
//
// A positioned world-layer div (like a shape) that renders the object by its
// (derived) status:
//   ready     → <img> from the served asset; a client load error →
//               "Image unavailable" box (broken-image icon)
//   uploading → image icon + progress bar with percentage to the uploader
//               (progress is local, not shared), "Uploading…" to everyone else
//   failed    → "Upload failed" + Retry (when the file is still in memory) +
//               Remove to the uploader; "Image unavailable" to other
//               participants
//   unfinished→ "Image upload didn't finish" + "Remove" (image.unfinished)
//
// Select/move/resize/delete come unchanged from the registry: the type is
// aspect-locked (image.aspect_resize) with a minimum side.

import { useEffect, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import type { ImageSnap } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';
import { useImageUpload } from '../images/ImageUploadContext';
import { getIdentityId } from '../identity';
import type { ObjectProps } from './registry';

export function ImageObject(props: ObjectProps): JSX.Element {
  const { obj, selected } = props;
  const img = obj as ImageSnap;
  const api = useImageUpload();
  const me = getIdentityId();
  const isUploader = img.uploaderId !== '' && img.uploaderId === me;

  const [loadError, setLoadError] = useState(false);
  const [, forceTick] = useState(0);
  const status = displayStatus(img, Date.now());

  // A client-side load failure is render-only (not written to the doc).
  useEffect(() => {
    if (status !== 'ready') setLoadError(false);
  }, [status, img.assetKey]);

  // Keep a stuck upload fresh so it flips to `unfinished` live (re-render
  // every 30 s while uploading; design image.object).
  useEffect(() => {
    if (status !== 'uploading') return;
    const t = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [status]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // A press on a Retry/Remove button must not start a move.
    if ((e.target as HTMLElement).closest('button') !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    props.onPointerDown(e);
  };

  // The placeholder icons (PRD structure): a photo glyph for the uploader's
  // uploading box and a broken-image glyph for unavailable/failed-for-others.
  const photoIcon = (
    <svg className="image-object__icon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="10" r="2" fill="currentColor" />
      <path d="M4 17l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
  const brokenIcon = (
    <svg className="image-object__icon image-object__icon--broken" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3L4 21M16 3l4 18M4 9l16 6M4 15l16-6" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  );
  const unavailableBox = (
    <div className="image-object__unavailable" data-testid="image-unavailable">
      {brokenIcon}
      Image unavailable
    </div>
  );

  const info = api?.info(img.id);
  const progress = info?.progress;
  const canRetry = info?.canRetry ?? false;

  let body: JSX.Element;
  if (status === 'ready') {
    body = loadError || img.assetKey === null ? (
      unavailableBox
    ) : (
      <img
        className="image-object__img"
        data-testid="image-img"
        src={`/api/assets/${img.assetKey}`}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setLoadError(true)}
      />
    );
  } else if (status === 'uploading') {
    // The uploader sees the progress bar (0% until the first progress event)
    // whenever the local upload is theirs; everyone else sees "Uploading…".
    const mine = isUploader && (progress !== undefined || canRetry);
    const pct = Math.round((progress ?? 0) * 100);
    body = mine ? (
      <div
        className="image-object__progress"
        data-testid="image-progress"
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        {photoIcon}
        <span className="image-object__progress-bar" style={{ width: `${pct}%` }} />
        <span className="image-object__progress-text" data-testid="image-progress-text">
          {pct}%
        </span>
      </div>
    ) : (
      <div className="image-object__uploading" data-testid="image-uploading">
        Uploading…
      </div>
    );
  } else if (status === 'failed') {
    if (isUploader) {
      body = (
        <div className="image-object__state" data-testid="image-failed">
          <span className="image-object__state-text" data-testid="image-failed-text">Upload failed</span>
          {canRetry && (
            <button type="button" className="image-object__btn" data-testid="image-retry" onClick={() => api?.retry(img.id)}>
              Retry
            </button>
          )}
          <button type="button" className="image-object__btn" data-testid="image-remove" onClick={() => api?.remove(img.id)}>
            Remove
          </button>
        </div>
      );
    } else {
      body = unavailableBox;
    }
  } else {
    // 'unfinished'
    body = (
      <div className="image-object__state" data-testid="image-unfinished">
        <span className="image-object__state-text">Image upload didn't finish</span>
        <button type="button" className="image-object__btn" data-testid="image-remove" onClick={() => api?.remove(img.id)}>
          Remove
        </button>
      </div>
    );
  }

  return (
    <div
      className={`image-object image-object--${status}${selected ? ' is-selected' : ''}`}
      data-testid="image-object"
      data-image-id={img.id}
      data-status={status}
      data-selected={selected ? '' : undefined}
      role="group"
      aria-label="Image"
      tabIndex={0}
      style={{ left: img.x, top: img.y, width: img.width, height: img.height, zIndex: img.z }}
      onPointerDown={onPointerDown}
    >
      {body}
    </div>
  );
}
