/**
 * Story 12: ImageObject render (image.render).
 *
 * Render states (image.render, exact PRD wording):
 * - ready:            <img src=/api/assets/:boardId/:assetId> (immutable
 *                     cache — the key never changes). If the stored image
 *                     cannot be loaded → "Image unavailable" box of the
 *                     same size.
 * - uploading (self): dashed placeholder + "Uploading… NN%" (progress
 *                     from the XHR in useImageInsert).
 * - unfinished (stale > 5 min, everyone): "Image upload didn't finish"
 *                     + Remove (removes the object).
 * - uploading (other peer): dashed placeholder + "Uploading…" (no number).
 * - failed (self):     red-tinted placeholder + "Upload failed" + Retry
 *                     (when the File is still in memory) + Remove.
 * - failed (other):    "Image unavailable".
 *
 * The object is selected/moved/resized like any other object (aspect-locked
 * in the registry); the image fills the box.
 */
import { useState } from 'react';
import type { ObjectProps } from './registry';
import { displayStatus, type ImageSnap } from '@shared/objects/image';

export interface ImageObjectExtraProps {
  /** Upload progress 0..1 for the local uploader (undefined for others). */
  imageProgress?: number;
  /** True when this client is the uploader of this image. */
  imageIsUploader?: boolean;
  /** Current time for the stale-upload ('unfinished') derivation. */
  imageNow?: number;
  /** True when the failed File is still available for retry. */
  imageCanRetry?: boolean;
  onImageRetry?: () => void;
  /** Remove the object from the board (PRD: Remove on failed/unfinished). */
  onImageRemove?: () => void;
}

const boxStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
};

const placeholderStyle: React.CSSProperties = {
  ...boxStyle,
  background: '#ffffff',
  border: '2px dashed #9ca3af',
  borderRadius: 4,
  color: '#4b5563',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  textAlign: 'center',
  overflow: 'hidden',
};

const failedStyle: React.CSSProperties = {
  ...placeholderStyle,
  background: '#fef2f2',
  border: '2px dashed #ef4444',
  color: '#b91c1c',
};

const unavailableStyle: React.CSSProperties = {
  ...placeholderStyle,
  background: '#f9fafb',
  border: '2px dashed #d1d5db',
  color: '#6b7280',
};

const buttonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '2px 10px',
  borderRadius: 4,
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

function ImageGlyph(): React.ReactElement {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M5 18l5-5 3 3 4-4 2 2" />
    </svg>
  );
}

export function ImageObject(props: ObjectProps & ImageObjectExtraProps): React.ReactElement {
  const {
    obj,
    selected,
    imageProgress,
    imageIsUploader = false,
    imageNow,
    imageCanRetry = false,
    onImageRetry,
    onImageRemove,
  } = props;
  // Keyed by assetKey so a new key (retry) starts with a fresh load state.
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onObjectPointerDown(e, obj.id);
  };

  const img = obj as unknown as ImageSnap;
  const loadFailed = failedKey !== null && failedKey === img.assetKey;
  const status = imageNow !== undefined ? displayStatus(img, imageNow) : img.status;
  const isSelected = selected ?? false;

  const outline = isSelected
    ? { outline: '2px solid #2563eb', outlineOffset: 1 }
    : {};

  // ready (or a stored image that failed to load)
  if ((status === 'ready' || loadFailed) && img.assetKey) {
    if (loadFailed) {
      return (
        <div
          data-vidi-object="image"
          data-image-status="unavailable"
          onPointerDown={handlePointerDown}
          style={{ ...unavailableStyle, ...outline }}
        >
          <ImageGlyph />
          <div style={{ fontSize: 13, lineHeight: 1.2 }}>Image unavailable</div>
        </div>
      );
    }
    return (
      <div
        data-vidi-object="image"
        data-image-status="ready"
        onPointerDown={handlePointerDown}
        style={{ ...boxStyle, ...outline, borderRadius: 2, overflow: 'hidden' }}
      >
        <img
          src={`/api/assets/${img.assetKey}`}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => setFailedKey(img.assetKey)}
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }}
        />
      </div>
    );
  }

  const isUploadingSelf = status === 'uploading' && imageIsUploader;
  const isUnfinished = status === 'unfinished';
  const isFailedSelf = status === 'failed' && imageIsUploader;
  const isFailedOther = status === 'failed' && !imageIsUploader;

  let label: string;
  let style: React.CSSProperties = placeholderStyle;
  let showRetry = false;
  let showRemove = false;

  if (isFailedOther) {
    label = 'Image unavailable';
    style = unavailableStyle;
  } else if (isFailedSelf) {
    label = 'Upload failed';
    style = failedStyle;
    showRetry = imageCanRetry;
    showRemove = true;
  } else if (isUnfinished) {
    label = "Image upload didn't finish";
    showRemove = true;
  } else if (isUploadingSelf) {
    const pct = Math.round((imageProgress ?? 0) * 100);
    label = `Uploading… ${pct}%`;
  } else {
    // uploading (other peer)
    label = 'Uploading…';
  }

  return (
    <div
      data-vidi-object="image"
      data-image-status={status}
      onPointerDown={handlePointerDown}
      style={{ ...style, ...outline }}
    >
      <ImageGlyph />
      <div style={{ fontSize: 13, lineHeight: 1.2 }}>{label}</div>
      {isUploadingSelf && (
        <div style={{ width: '70%', height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
          <div
            style={{
              width: `${Math.round((imageProgress ?? 0) * 100)}%`,
              height: '100%',
              background: '#2563eb',
            }}
          />
        </div>
      )}
      {showRetry && (
        <button
          type="button"
          data-testid="image-retry"
          onClick={onImageRetry}
          style={buttonStyle}
        >
          Retry
        </button>
      )}
      {showRemove && (
        <button
          type="button"
          data-testid="image-remove"
          onClick={onImageRemove}
          style={buttonStyle}
        >
          Remove
        </button>
      )}
    </div>
  );
}
