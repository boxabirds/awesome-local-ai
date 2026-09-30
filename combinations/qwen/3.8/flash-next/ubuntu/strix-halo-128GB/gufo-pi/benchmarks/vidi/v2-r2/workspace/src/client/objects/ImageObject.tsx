import { useState, useEffect, useRef, type ReactElement } from 'react';
import { displayStatus, type ImageSnap } from '@shared/objects/image';
import { deleteObjects } from '@shared/board-model';
import type { ObjectProps } from './registry';

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}

export function ImageObjectStateless({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
}: ImageObjectProps): ReactElement {
  const [loadError, setLoadError] = useState(false);
  const prevAssetKey = useRef(image.assetKey);

  // Reset load error when assetKey changes (e.g. retry)
  useEffect(() => {
    if (image.assetKey !== prevAssetKey.current) {
      setLoadError(false);
      prevAssetKey.current = image.assetKey;
    }
  }, [image.assetKey]);

  const status = displayStatus(image, now);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
  };

  if (status === 'uploading') {
    if (isUploader) {
      const pct = progress !== undefined ? Math.round(progress * 100) : 0;
      return (
        <div style={style} className="image-placeholder image-placeholder--uploading" role="img" aria-label="Image">
          <div className="image-placeholder-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
              <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="image-progress-bar">
            <div className="image-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="image-progress-text">{pct}%</span>
        </div>
      );
    }
    return (
      <div style={style} className="image-placeholder image-placeholder--uploading-other" role="img" aria-label="Image">
        <span>Uploading…</span>
      </div>
    );
  }

  if (status === 'failed') {
    if (isUploader) {
      return (
        <div style={style} className="image-placeholder image-placeholder--failed" role="img" aria-label="Image">
          <span className="image-failed-label">Upload failed</span>
          <div className="image-failed-actions">
            {canRetry && (
              <button
                className="image-failed-btn"
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                aria-label="Retry"
              >
                Retry
              </button>
            )}
            <button
              className="image-failed-btn"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              aria-label="Remove"
            >
              Remove
            </button>
          </div>
        </div>
      );
    }
    return (
      <div style={style} className="image-placeholder image-placeholder--unavailable" role="img" aria-label="Image">
        <BrokenImageIcon />
        <span>Image unavailable</span>
      </div>
    );
  }

  if (status === 'unfinished') {
    return (
      <div style={style} className="image-placeholder image-placeholder--unfinished" role="img" aria-label="Image">
        <span>Image upload didn't finish</span>
        <button
          className="image-failed-btn"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label="Remove"
        >
          Remove
        </button>
      </div>
    );
  }

  // status === 'ready'
  if (loadError) {
    return (
      <div style={style} className="image-placeholder image-placeholder--unavailable" role="img" aria-label="Image">
        <BrokenImageIcon />
        <span>Image unavailable</span>
      </div>
    );
  }

  const src = image.assetKey ? `/api/assets/${image.assetKey}` : '';

  return (
    <div style={style} className="image-object" role="img" aria-label="Image">
      <img
        src={src}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        style={{ width: '100%', height: '100%', objectFit: 'fill' }}
        onError={() => setLoadError(true)}
      />
    </div>
  );
}

function BrokenImageIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="1.5" />
      <line x1="20" y1="4" x2="4" y2="20" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * Wrapper component that connects the ImageObject to the board's doc and identity.
 */
export function ImageObjectWrapper(props: ObjectProps & {
  identityId: string;
  progress?: number;
  canRetry: boolean;
  onRetry(): void;
  doc: import('yjs').Doc;
}): ReactElement {
  const { obj, identityId, progress, canRetry, onRetry, doc } = props;
  const image = obj as ImageSnap;
  const isUploader = image.uploaderId === identityId;

  const handleRemove = () => {
    deleteObjects(doc, [image.id]);
  };

  return (
    <ImageObjectStateless
      image={image}
      isUploader={isUploader}
      progress={progress}
      canRetry={canRetry}
      now={Date.now()}
      onRetry={onRetry}
      onRemove={handleRemove}
    />
  );
}
