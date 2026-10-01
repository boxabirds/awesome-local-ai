/**
 * ImageObject: renders image objects in all their states (uploading, ready, failed, unfinished).
 */

import { useState, useEffect } from 'react';
import type { ImageSnap, DisplayStatus } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
  selected?: boolean;
  onSelect?(id: string): void;
  onToggle?(id: string, shift: boolean): void;
  onObjectPointerDown?(e: React.PointerEvent, id: string): void;
  zoom: number;
  canEdit: boolean;
}

export function ImageObject(props: ImageObjectProps) {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove, selected, onSelect, onToggle, onObjectPointerDown } = props;
  const [loadError, setLoadError] = useState(false);

  // Reset loadError when assetKey changes
  useEffect(() => {
    setLoadError(false);
  }, [image.assetKey]);

  const status: DisplayStatus = image.status === 'ready' && loadError ? 'unavailable' : displayStatus(image, now);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
    zIndex: image.z,
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (onObjectPointerDown) {
      onObjectPointerDown(e, image.id);
    } else if (onSelect) {
      if (e.shiftKey && onToggle) {
        onToggle(image.id, true);
      } else {
        onSelect(image.id);
      }
    }
  };

  // Ready state: show the image
  if (status === 'ready' && image.assetKey) {
    return (
      <div
        className={`board-object image-object ${selected ? 'selected' : ''}`}
        data-testid="image-object"
        data-object-id={image.id}
        data-object-type="image"
        style={style}
        onPointerDown={handlePointerDown}
        aria-label="Image"
      >
        <img
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
          onError={() => setLoadError(true)}
        />
      </div>
    );
  }

  // Unavailable state: image failed to load
  if (status === 'unavailable') {
    return (
      <div
        className={`board-object image-object image-unavailable ${selected ? 'selected' : ''}`}
        data-testid="image-object"
        data-object-id={image.id}
        data-object-type="image"
        style={{ ...style, backgroundColor: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#757575', fontSize: 14 }}
        onPointerDown={handlePointerDown}
        aria-label="Image unavailable"
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="3" x2="21" y2="21" />
        </svg>
        <span>Image unavailable</span>
      </div>
    );
  }

  // Uploading state (not stale)
  if (status === 'uploading') {
    if (isUploader) {
      const pct = progress !== undefined ? Math.round(progress * 100) : 0;
      return (
        <div
          className={`board-object image-object image-uploading ${selected ? 'selected' : ''}`}
          data-testid="image-object"
          data-object-id={image.id}
          data-object-type="image"
          style={{ ...style, backgroundColor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', border: '1px solid #ccc' }}
          onPointerDown={handlePointerDown}
          aria-label="Image"
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <div style={{ width: '80%', height: 6, backgroundColor: '#ddd', borderRadius: 3, marginTop: 8 }}>
            <div style={{ width: `${pct}%`, height: '100%', backgroundColor: '#1E88E5', borderRadius: 3, transition: 'width 0.2s' }} />
          </div>
          <span style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{pct}%</span>
        </div>
      );
    }
    return (
      <div
        className={`board-object image-object image-uploading-other ${selected ? 'selected' : ''}`}
        data-testid="image-object"
        data-object-id={image.id}
        data-object-type="image"
        style={{ ...style, backgroundColor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #ccc', color: '#757575', fontSize: 14 }}
        onPointerDown={handlePointerDown}
        aria-label="Image"
      >
        <span>Uploading…</span>
      </div>
    );
  }

  // Failed state
  if (status === 'failed') {
    if (isUploader) {
      return (
        <div
          className={`board-object image-object image-failed ${selected ? 'selected' : ''}`}
          data-testid="image-object"
          data-object-id={image.id}
          data-object-type="image"
          style={{ ...style, backgroundColor: '#fff5f5', border: '2px solid #E53935', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#E53935', fontSize: 14, gap: 8 }}
          onPointerDown={handlePointerDown}
          aria-label="Upload failed"
        >
          <span>Upload failed</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {canRetry && (
              <button
                type="button"
                data-testid="retry-button"
                style={{ padding: '4px 12px', cursor: 'pointer', border: '1px solid #E53935', borderRadius: 4, background: '#fff', color: '#E53935' }}
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              data-testid="remove-button"
              style={{ padding: '4px 12px', cursor: 'pointer', border: '1px solid #999', borderRadius: 4, background: '#fff', color: '#333' }}
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
            >
              Remove
            </button>
          </div>
        </div>
      );
    }
    return (
      <div
        className={`board-object image-object image-unavailable-other ${selected ? 'selected' : ''}`}
        data-testid="image-object"
        data-object-id={image.id}
        data-object-type="image"
        style={{ ...style, backgroundColor: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#757575', fontSize: 14 }}
        onPointerDown={handlePointerDown}
        aria-label="Image unavailable"
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="3" x2="21" y2="21" />
        </svg>
        <span>Image unavailable</span>
      </div>
    );
  }

  // Unfinished state
  if (status === 'unfinished') {
    return (
      <div
        className={`board-object image-object image-unfinished ${selected ? 'selected' : ''}`}
        data-testid="image-object"
        data-object-id={image.id}
        data-object-type="image"
        style={{ ...style, backgroundColor: '#f0f0f0', border: '1px solid #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#757575', fontSize: 14, gap: 8 }}
        onPointerDown={handlePointerDown}
        aria-label="Image upload didn't finish"
      >
        <span>Image upload didn't finish</span>
        <button
          type="button"
          data-testid="remove-button"
          style={{ padding: '4px 12px', cursor: 'pointer', border: '1px solid #999', borderRadius: 4, background: '#fff', color: '#333' }}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          Remove
        </button>
      </div>
    );
  }

  // Fallback
  return (
    <div
      className="board-object image-object"
      data-testid="image-object"
      data-object-id={image.id}
      data-object-type="image"
      style={style}
      onPointerDown={handlePointerDown}
    />
  );
}
