// Image object rendering and states (see spec: image.object).
//
// One component renders the standard selectable wrapper (positioning,
// pointer select, keyboard focus) plus the state content:
//   uploading   grey box; the uploader sees live progress %, others "Uploading…"
//   ready       <img> from the immutable serve route; an img error event
//               renders "Image unavailable" (image.unavailable)
//   failed      uploader: "Upload failed" + Retry (if the File is in memory)
//               + Remove; others: "Image unavailable"
//   unfinished  "Image upload didn't finish" + Remove
// data-status on the wrapper is the *display* status: 'unavailable' when a
// ready image's <img> failed to load (doc status stays 'ready').
// Remove deletes the object (story 7); Retry re-uploads via useImageInsert.

import { useEffect, useState, type JSX } from 'react';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import type { ObjectProps } from './registry';

export function ImageObject(props: ObjectProps): JSX.Element {
  const image = props.obj as ImageSnap;
  const {
    selected,
    dragging,
    onObjectPointerDown,
    onFocusSelect,
    imageContext,
  } = props;
  const isUploader = imageContext?.isUploader ?? false;
  const progress = imageContext?.progress;
  const canRetry = imageContext?.canRetry ?? false;
  const now = imageContext?.now ?? Date.now();
  const onRetry = () => imageContext?.onRetry();
  const onRemove = () => imageContext?.onRemove();

  const readyReady = image.status === 'ready' && image.assetKey !== null;
  // Client-only: the <img> of a ready object failed to load. A new
  // assetKey (e.g. after a successful retry) re-tries the load.
  const [loadFailed, setLoadFailed] = useState(false);
  const assetKey = readyReady ? image.assetKey : null;
  useEffect(() => {
    setLoadFailed(false);
  }, [assetKey]);
  const status = readyReady && loadFailed ? 'unavailable' : displayStatus(image, now);

  let content: JSX.Element;
  if (status === 'uploading') {
    content = (
      <div
        data-testid="image-placeholder"
        className="image-object__placeholder"
        style={{
          position: 'absolute',
          inset: 0,
          background: '#e8eaed',
          border: '1px dashed #9aa0a6',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {isUploader ? (
          <span data-testid="image-progress" style={{ fontSize: 12, color: '#5f6368' }}>
            {Math.round((progress ?? 0) * 100)}%
          </span>
        ) : (
          <span data-testid="image-uploading" style={{ fontSize: 12, color: '#5f6368' }}>
            Uploading…
          </span>
        )}
      </div>
    );
  } else if (readyReady && !loadFailed) {
    content = (
      <img
        data-testid="image-img"
        className="image-object__img"
        src={`/api/assets/${image.assetKey}`}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setLoadFailed(true)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          borderRadius: 2,
        }}
      />
    );
  } else {
    const failed = status === 'failed';
    const label =
      status === 'unfinished'
        ? "Image upload didn't finish"
        : failed && isUploader
          ? 'Upload failed'
          : 'Image unavailable';
    content = (
      <div
        data-testid={status === 'failed' && isUploader ? 'image-failed' : 'image-unavailable'}
        className="image-object__error"
        style={{
          position: 'absolute',
          inset: 0,
          background: '#f1f3f4',
          border: '1px solid #c9ced6',
          borderRadius: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          overflow: 'hidden',
        }}
      >
        <span data-testid="image-error-label" style={{ fontSize: 12, color: '#5f6368' }}>
          {label}
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          {failed && isUploader && canRetry && (
            <button
              type="button"
              data-testid="image-retry"
              style={BUTTON_STYLE}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onRetry}
            >
              Retry
            </button>
          )}
          {(status === 'unfinished' || (failed && isUploader)) && (
            <button
              type="button"
              data-testid="image-remove"
              style={BUTTON_STYLE}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onRemove}
            >
              Remove
            </button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="image"
      data-testid="image-object"
      data-id={image.id}
      data-status={status}
      data-dragging={dragging ? 'true' : 'false'}
      data-selected={selected || undefined}
      tabIndex={0}
      className="image-object"
      style={{
        left: image.x,
        top: image.y,
        width: image.width ?? 100,
        height: image.height ?? 50,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => onObjectPointerDown(e, image.id)}
      onFocus={() => onFocusSelect(image.id)}
    >
      {content}
    </div>
  );
}

const BUTTON_STYLE: React.CSSProperties = {
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid #c9ced6',
  background: '#fff',
  cursor: 'pointer',
};
