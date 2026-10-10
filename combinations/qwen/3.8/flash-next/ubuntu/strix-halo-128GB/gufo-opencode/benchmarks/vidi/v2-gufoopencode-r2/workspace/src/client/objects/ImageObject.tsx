// Story 12 image object: the ready image, and the non-ready states —
// uploading (uploader sees live percentage, others see "Uploading…"),
// unfinished (upload started more than IMAGE_UPLOAD_STALE_MS ago), failed
// (uploader gets Retry/Remove; others get "Image unavailable") and the
// load-error fallback for stored images that no longer serve.

import { useContext, useState } from 'react';
import type { ObjectProps } from './registry';
import { ImageControllerContext } from '../images/useImageInsert';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import { getIdentity } from '../identity/identity';

function BrokenImageIcon(): React.JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 15l5-4 4 3 3-2 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function ImageObject({
  obj,
  selected,
  editable,
  onObjectPointerDown,
}: ObjectProps): React.JSX.Element {
  const image = obj as ImageSnap;
  const controller = useContext(ImageControllerContext);
  const [loadFailed, setLoadFailed] = useState(false);
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  const isUploader = image.uploaderId === getIdentity().id;

  const status = displayStatus(image, controller?.now());
  const progress = status === 'uploading' && isUploader ? controller?.progressFor(image.id) : null;

  const showUnavailable =
    (status === 'ready' && loadFailed) || (status === 'failed' && !isUploader);

  return (
    <div
      role="img"
      aria-label="Image"
      data-testid="image-object"
      data-image-id={image.id}
      data-image-status={status}
      data-selected={selected ? 'true' : 'false'}
      className={`image-object${status === 'failed' && isUploader ? ' image-object-failed' : ''}`}
      tabIndex={0}
      style={
        {
          left: image.x,
          top: image.y,
          width,
          height,
          zIndex: image.z,
        } as React.CSSProperties
      }
      onPointerDown={(e) => {
        if (!editable) return;
        e.stopPropagation();
        onObjectPointerDown(e, image.id);
      }}
    >
      {status === 'ready' && !loadFailed && image.assetKey !== null ? (
        <img
          className="image-object-img"
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setLoadFailed(true)}
        />
      ) : status === 'uploading' && isUploader && progress !== null ? (
        <div className="image-state image-state-uploading" data-testid="image-uploading-self">
          <span data-testid="image-upload-progress">{`Uploading ${progress}%`}</span>
        </div>
      ) : status === 'uploading' ? (
        <div className="image-state image-state-placeholder" data-testid="image-uploading-other">
          <span>Uploading…</span>
        </div>
      ) : status === 'failed' && isUploader ? (
        <div className="image-state image-state-failed" data-testid="image-failed">
          <span>Upload failed</span>
          <span className="image-state-actions">
            {controller?.hasFile(image.id) ? (
              <button
                type="button"
                className="image-action-button"
                data-testid="image-retry"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => controller?.retry(image.id)}
              >
                Retry
              </button>
            ) : null}
            <button
              type="button"
              className="image-action-button"
              data-testid="image-remove"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => controller?.remove(image.id)}
            >
              Remove
            </button>
          </span>
        </div>
      ) : status === 'unfinished' ? (
        <div className="image-state image-state-placeholder" data-testid="image-unfinished">
          <span>Image upload didn't finish</span>
          <span className="image-state-actions">
            <button
              type="button"
              className="image-action-button"
              data-testid="image-remove"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => controller?.remove(image.id)}
            >
              Remove
            </button>
          </span>
        </div>
      ) : showUnavailable ? (
        <div className="image-state image-state-placeholder" data-testid="image-unavailable">
          <BrokenImageIcon />
          <span>Image unavailable</span>
        </div>
      ) : null}
    </div>
  );
}
