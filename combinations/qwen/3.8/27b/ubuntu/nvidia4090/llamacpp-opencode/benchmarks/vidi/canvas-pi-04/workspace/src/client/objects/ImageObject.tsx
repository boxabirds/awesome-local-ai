// Story 12: one image (anchor: image.object).
//
// A positioned world-layer div (like a shape) that renders the object by its
// (derived) status:
//   ready     → <img> from the served asset; a client load error → "Image unavailable"
//   uploading → a progress bar to the uploader (progress is local, not shared),
//               "Uploading…" to everyone else
//   failed    → "Retry" + "Remove" to the uploader (when the file is still in
//               memory), "Remove" only after a reload, "Image unavailable" to
//               other participants
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

  // Keep a stuck upload fresh so it flips to `unfinished` live.
  useEffect(() => {
    if (status !== 'uploading') return;
    const t = setInterval(() => forceTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, [status]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // A press on a Retry/Remove button must not start a move.
    if ((e.target as HTMLElement).closest('button') !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    props.onPointerDown(e);
  };

  const info = api?.info(img.id);
  const progress = info?.progress;
  const canRetry = info?.canRetry ?? false;

  let body: JSX.Element;
  if (status === 'ready') {
    body = loadError || img.assetKey === null ? (
      <div className="image-object__unavailable" data-testid="image-unavailable">
        Image unavailable
      </div>
    ) : (
      <img
        className="image-object__img"
        data-testid="image-img"
        src={`/api/assets/${img.assetKey}`}
        alt=""
        draggable={false}
        onError={() => setLoadError(true)}
      />
    );
  } else if (status === 'uploading') {
    body = isUploader && progress !== undefined ? (
      <div
        className="image-object__progress"
        data-testid="image-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span className="image-object__progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
        <span className="image-object__progress-text" data-testid="image-progress-text">
          {Math.round(progress * 100)}%
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
          <span className="image-object__state-text">Image unavailable</span>
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
      body = (
        <div className="image-object__unavailable" data-testid="image-unavailable">
          Image unavailable
        </div>
      );
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
