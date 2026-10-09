import { useEffect, useState } from 'react';
import type { CSSProperties, JSX, ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { deleteObjects, isImageObject } from '../../shared/board-model';
import { displayStatus } from '../../shared/objects/image';
import { useUndoController } from '../board/useUndo';
import { getSessionId } from '../session';
import { useImageInsertContext } from '../images/ImageInsertContext';
import type { ObjectProps } from './registry';

// One interval shared by every uploading image so 'unfinished' appears within
// 30 seconds of the stale threshold without user interaction (image.unfinished).
const CLOCK_INTERVAL_MS = 30_000;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const listener = (): void => setNow(Date.now());
    clockListeners.add(listener);
    if (clockTimer === null) {
      clockTimer = setInterval(() => {
        for (const notify of clockListeners) notify();
      }, CLOCK_INTERVAL_MS);
    }
    return () => {
      clockListeners.delete(listener);
      if (clockListeners.size === 0 && clockTimer !== null) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
    };
  }, [active]);
  return now;
}

const STOP = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation();
  }
};

function StatusBox({ testId, children }: { testId: string; children: ReactNode }): JSX.Element {
  return (
    <div
      data-testid={testId}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontSize: 16,
        color: '#5b6472',
        textAlign: 'center',
        padding: 8
      }}
    >
      {children}
    </div>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick(): void }): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={`image-action-${label.toLowerCase()}`}
      style={{
        border: '1px solid #d6dae1',
        background: '#ffffff',
        borderRadius: 6,
        padding: '2px 10px',
        fontSize: 14,
        cursor: 'pointer'
      }}
      {...STOP}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

// Story 12: the image renderer switches on displayStatus, not the raw status,
// so an abandoned upload stops pretending to be in progress (image.unfinished).
// Remove uses story 7's deleteObjects wrapped in an undo boundary; Retry goes
// through the insert session and is only offered while the file is in memory.
export function ImageObject(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, dragging, editable } = props;
  const image = isImageObject(obj) ? obj : null;
  const insert = useImageInsertContext();
  const undo = useUndoController();
  const [imgError, setImgError] = useState(false);
  const assetKey = image?.assetKey ?? null;
  useEffect(() => {
    setImgError(false);
  }, [assetKey]);
  const now = useClock(image?.status === 'uploading');

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    props.onObjectPointerDown(event, obj.id);
  };

  const rootStyle: CSSProperties = {
    position: 'absolute',
    left: obj.x,
    top: obj.y,
    width: obj.width,
    height: obj.height,
    zIndex: obj.z,
    outline: selected ? '2px solid #1E88E5' : 'none',
    cursor: dragging ? 'grabbing' : 'grab',
    // The world layer disables hit testing; each object opts back in.
    pointerEvents: 'auto',
    background: image === null || displayStatus(image, now) === 'ready' ? 'transparent' : '#e8eaee',
    borderRadius: 2,
    overflow: 'hidden'
  };

  const remove = (): void => {
    undo?.boundary();
    deleteObjects(doc, [obj.id]);
    undo?.boundary();
  };

  let content: JSX.Element;
  if (image === null) {
    content = <StatusBox testId={`image-unavailable-${obj.id}`}>Image unavailable</StatusBox>;
  } else {
    const status = displayStatus(image, now);
    const isUploader = image.uploaderId === getSessionId();
    if (status === 'uploading') {
      if (isUploader) {
        const fraction = insert?.getProgress(obj.id) ?? 0;
        const percent = Math.round(fraction * 100);
        content = (
          <StatusBox testId={`image-uploading-${obj.id}`}>
            <span aria-hidden="true">🖼</span>
            <div
              data-testid={`image-progress-bar-${obj.id}`}
              style={{ width: '70%', height: 6, background: '#c9ced6', borderRadius: 3, overflow: 'hidden' }}
            >
              <div style={{ width: `${percent}%`, height: '100%', background: '#1E88E5' }} />
            </div>
            <span data-testid={`image-progress-${obj.id}`}>{percent}%</span>
          </StatusBox>
        );
      } else {
        content = (
          <StatusBox testId={`image-pending-${obj.id}`}>
            <span aria-hidden="true">🖼</span>
            <span>Uploading…</span>
          </StatusBox>
        );
      }
    } else if (status === 'failed') {
      if (isUploader) {
        content = (
          <div
            data-testid={`image-failed-${obj.id}`}
            style={{
              position: 'absolute',
              inset: 0,
              border: '2px solid #d33a2f',
              borderRadius: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontSize: 16,
              color: '#b3261e',
              textAlign: 'center',
              padding: 8
            }}
          >
            <span>Upload failed</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {insert?.canRetry(obj.id) === true ? (
                <ActionButton label="Retry" onClick={() => insert?.retry(obj.id)} />
              ) : null}
              {editable ? <ActionButton label="Remove" onClick={remove} /> : null}
            </div>
          </div>
        );
      } else {
        content = (
          <StatusBox testId={`image-unavailable-${obj.id}`}>
            <span aria-hidden="true">⚠️</span>
            <span>Image unavailable</span>
          </StatusBox>
        );
      }
    } else if (status === 'unfinished') {
      content = (
        <StatusBox testId={`image-unfinished-${obj.id}`}>
          <span>Image upload didn&apos;t finish</span>
          {editable ? <ActionButton label="Remove" onClick={remove} /> : null}
        </StatusBox>
      );
    } else if (assetKey === null || imgError) {
      content = (
        <StatusBox testId={`image-unavailable-${obj.id}`}>
          <span aria-hidden="true">⚠️</span>
          <span>Image unavailable</span>
        </StatusBox>
      );
    } else {
      content = (
        <img
          src={`/api/assets/${assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          data-testid={`image-bitmap-${obj.id}`}
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }}
        />
      );
    }
  }

  return (
    <div
      role="group"
      aria-label="Image"
      data-testid={`image-${obj.id}`}
      data-selected={selected}
      data-dragging={dragging}
      style={rootStyle}
      tabIndex={0}
      onPointerDown={onPointerDown}
    >
      {content}
    </div>
  );
}
