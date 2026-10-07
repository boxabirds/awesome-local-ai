/**
 * Story 12 — Image object rendering component.
 *
 * Renders images in their various states: uploading, ready, failed, unfinished, unavailable.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { displayStatus } from '@/shared/objects/image';
import type { DisplayStatus, ImageSnap } from '@/shared/objects/image';

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}

interface InternalState {
  status: DisplayStatus;
  imgLoaded: boolean;
  imgError: boolean;
}

/** Shared clock tick for stale detection. Re-renders every 30s while any image is uploading. */
let _tickInterval: ReturnType<typeof setInterval> | null = null;
let _tickCount = 0;

export function getGlobalTick(): number {
  _tickCount++;
  return _tickCount;
}

export function ensureClockTick(): () => void {
  if (_tickInterval) return () => {};
  // Start a timer that increments a shared counter for re-rendering
  _tickInterval = setInterval(() => {
    _tickCount++;
    // Force re-render of all ImageObjects by notifying registered handlers
    for (const fn of _tickHandlers) {
      fn();
    }
  }, 30_000);
  return () => { /* cleanup called by parent */ };
}

const _tickHandlers = new Set<() => void>();

export function registerTickHandler(fn: () => void): () => void {
  _tickHandlers.add(fn);
  return () => { _tickHandlers.delete(fn); };
}

function IconImage(): ReactNode {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9e9e9e" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function IconBroken(): ReactNode {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9e9e9e" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2" />
      <line x1="3" y1="3" x2="21" y2="21" />
      <line x1="21" y1="3" x2="3" y2="21" />
    </svg>
  );
}

export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
}: ImageObjectProps): ReactNode {
  const [, setTick] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgReady, setImgReady] = useState(true);
  const [imgErrored, setImgErrored] = useState(false);

  // Subscribe to global tick
  useEffect(() => {
    const unsub = registerTickHandler(() => setTick(t => t + 1));
    return unsub;
  }, []);

  // Derive display status from snapshot
  const effectiveNow = now || Date.now();
  const status = displayStatus(image, effectiveNow);

  // Handle image load / error
  const handleImgLoad = useCallback(() => {
    setImgReady(true);
    setImgErrored(false);
  }, []);

  const handleImgError = useCallback(() => {
    setImgReady(false);
    setImgErrored(true);
  }, []);

  const w = Math.round(image.width);
  const h = Math.round(image.height);

  // ── Render based on status ──────────────────────────────

  if (status === 'ready' && image.assetKey && !imgErrored && imgReady) {
    return (
      <div
        style={{
          position: 'absolute',
          left: `${image.x}px`,
          top: `${image.y}px`,
          width: `${w}px`,
          height: `${h}px`,
          overflow: 'hidden',
        }}
      >
        <img
          ref={imgRef}
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          onLoad={handleImgLoad}
          onError={handleImgError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </div>
    );
  }

  // Failed or unavailable state
  if (status === 'failed') {
    if (!isUploader) {
      // Others see "Image unavailable"
      return (
        <div
          style={{
            position: 'absolute',
            left: `${image.x}px`,
            top: `${image.y}px`,
            width: `${w}px`,
            height: `${h}px`,
            background: '#f5f5f5',
            border: '1px solid #e0e0e0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            color: '#9e9e9e',
            fontSize: '13px',
          }}
        >
          <IconBroken />
          <span>Image unavailable</span>
        </div>
      );
    }
    // Uploader sees "Upload failed" with Retry and Remove
    return (
      <div
        style={{
          position: 'absolute',
          left: `${image.x}px`,
          top: `${image.y}px`,
          width: `${w}px`,
          height: `${h}px`,
          background: '#fff',
          border: '2px solid #e53935',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          color: '#d63031',
          fontSize: '13px',
        }}
      >
        <span style={{ fontWeight: 500 }}>Upload failed</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canRetry && (
            <button
              onClick={() => onRetry()}
              aria-label="Retry upload"
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                cursor: 'pointer',
                backgroundColor: '#e53935',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
              }}
            >
              Retry
            </button>
          )}
          <button
            onClick={() => onRemove()}
            aria-label="Remove image"
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              cursor: 'pointer',
              backgroundColor: '#757575',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
            }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  // Unfinished state
  if (status === 'unfinished') {
    return (
      <div
        style={{
          position: 'absolute',
          left: `${image.x}px`,
          top: `${image.y}px`,
          width: `${w}px`,
          height: `${h}px`,
          background: '#fafafa',
          border: '1px solid #e0e0e0',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          color: '#757575',
          fontSize: '13px',
        }}
      >
        <span>Image upload didn't finish</span>
        <button
          onClick={() => onRemove()}
          aria-label="Remove image"
          style={{
            padding: '4px 12px',
            fontSize: '12px',
            cursor: 'pointer',
            backgroundColor: '#757575',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          Remove
        </button>
      </div>
    );
  }

  // Uploading state
  if (status === 'uploading') {
    const pct = progress ?? 0;
    if (isUploader) {
      return (
        <div
          style={{
            position: 'absolute',
            left: `${image.x}px`,
            top: `${image.y}px`,
            width: `${w}px`,
            height: `${h}px`,
            background: '#e0e0e0',
            borderRadius: '4px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            overflow: 'hidden',
          }}
        >
          {/* Progress bar background */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: `${Math.min(pct, 100)}%`,
              background: '#90caf9',
              opacity: 0.5,
            }}
          />
          <IconImage />
          <span style={{ zIndex: 1, color: '#424242', fontSize: '13px' }}>{pct}%</span>
        </div>
      );
    }
    // Others see generic "Uploading…"
    return (
      <div
        style={{
          position: 'absolute',
          left: `${image.x}px`,
          top: `${image.y}px`,
          width: `${w}px`,
          height: `${h}px`,
          background: '#e0e0e0',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#757575',
          fontSize: '14px',
        }}
      >
        Uploading…
      </div>
    );
  }

  // Default fallback (shouldn't happen but safety net)
  return (
    <div
      style={{
        position: 'absolute',
        left: `${image.x}px`,
        top: `${image.y}px`,
        width: `${w}px`,
        height: `${h}px`,
        background: '#f5f5f5',
        border: '1px solid #e0e0e0',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9e9e9e',
      }}
    >
      <IconImage />
    </div>
  );
}
