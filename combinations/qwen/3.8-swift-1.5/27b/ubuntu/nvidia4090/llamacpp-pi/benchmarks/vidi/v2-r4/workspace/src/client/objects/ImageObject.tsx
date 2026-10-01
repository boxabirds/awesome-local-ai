import { useState, type JSX } from 'react';
import { displayStatus } from '../../shared/objects/image';
import type { ImageSnap } from '../../shared/objects/image';
import type { ObjectProps } from './registry';

export interface ImageObjectProps extends ObjectProps {
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}

const boxBase: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  boxSizing: 'border-box',
  fontSize: 12,
  textAlign: 'center',
  overflow: 'hidden',
};

/**
 * Image object (story 12, image.object). One rendering per display status:
 * uploading (progress for the uploader, "Uploading…" for others), ready
 * (<img>), failed (uploader: "Upload failed" + Retry/Remove; others:
 * "Image unavailable"), unfinished ("Image upload didn't finish" + Remove).
 * A failed <img> load swaps in a grey "Image unavailable" box locally.
 */
export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { obj, selected, editable, onPointerDown, isUploader, progress, canRetry, now, onRetry, onRemove } = props;
  const [loadError, setLoadError] = useState(false);

  const img = obj as ImageSnap;
  const status = displayStatus(img, now);
  const width = img.width;
  const height = img.height;

  const pct = progress != null ? Math.round(progress * 100) : 0;

  let inner: JSX.Element;
  if (status === 'ready' && img.assetKey && !loadError) {
    inner = (
      <img
        src={`/api/assets/${img.assetKey}`}
        draggable={false}
        decoding="async"
        loading="lazy"
        alt="Image"
        onError={() => setLoadError(true)}
        style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
      />
    );
  } else if (status === 'uploading') {
    inner = (
      <div data-testid="image-uploading" style={{ ...boxBase, backgroundColor: '#ECEFF1', color: '#546E7A' }}>
        <span>{isUploader ? `${pct}%` : 'Uploading…'}</span>
      </div>
    );
  } else if (status === 'failed' && isUploader) {
    inner = (
      <div
        data-testid="image-failed"
        style={{
          ...boxBase,
          backgroundColor: '#FDECEA',
          border: '2px solid #E53935',
          borderRadius: 4,
          color: '#B71C1C',
        }}
      >
        <span>Upload failed</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {canRetry && (
            <button
              data-testid="image-retry"
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              style={smallButton}
            >
              Retry
            </button>
          )}
          <button
            data-testid="image-remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            style={smallButton}
          >
            Remove
          </button>
        </div>
      </div>
    );
  } else if (status === 'failed' || loadError) {
    // failed (non-uploader) or a ready image that failed to load
    inner = (
      <div data-testid="image-unavailable" style={{ ...boxBase, backgroundColor: '#ECEFF1', color: '#78909C' }}>
        <span aria-hidden>🖻</span>
        <span>Image unavailable</span>
      </div>
    );
  } else {
    // unfinished
    inner = (
      <div
        data-testid="image-unfinished"
        style={{ ...boxBase, backgroundColor: '#ECEFF1', border: '1px solid #B0BEC5', borderRadius: 4, color: '#546E7A' }}
      >
        <span>Image upload didn't finish</span>
        <button
          data-testid="image-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={smallButton}
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Image"
      data-testid="image-object"
      data-selected={selected || undefined}
      data-image-id={img.id}
      onPointerDown={(e) => {
        if (!editable) {
          e.stopPropagation();
          return;
        }
        onPointerDown(e, img.id);
      }}
      style={{
        position: 'absolute',
        left: img.x,
        top: img.y,
        width,
        height,
        outline: selected ? '3px solid #2196F3' : 'none',
        outlineOffset: 2,
        cursor: editable ? 'grab' : 'default',
      }}
    >
      {inner}
    </div>
  );
}

const smallButton: React.CSSProperties = {
  padding: '2px 10px',
  border: '1px solid #B0BEC5',
  borderRadius: 4,
  backgroundColor: '#fff',
  cursor: 'pointer',
  fontSize: 12,
};
