/**
 * Story 12 · task 6 — the image object (design "ImageObject", PRD
 * `image.select`, `image.resize`).
 *
 * One absolutely positioned `div[role=group]` in the (scaled) world layer, whose
 * content depends on the object's state (design state diagram):
 *
 *  - `uploading` — a loading indicator (the placeholder, PRD `image.uploading`);
 *  - `ready` — the picture itself;
 *  - `failed` — an error indicator with a Retry and a Remove;
 *  - `unfinished` — "Image upload didn't finish" and a Remove.
 *
 * Selection and move are the shared {@link useObjectInteraction} path, so a
 * transparent corner still selects by *coordinate* (PRD `image.select`) rather
 * than by pixel. When a lone `ready` image is selected, the eight resize handles
 * appear and drag it through the one {@link TransformController}; because the
 * image registers as `aspectLocked` with `handles: 'all'`, a corner drag scales
 * it proportionally (PRD `image.resize`). The other states have nothing to
 * resize, so they render no handles.
 *
 * The `src` is resolved by the parent (it is the only place that knows the board
 * id), which keeps this file a pure function of its props — and lets a component
 * test feed it a `data:` URL instead of a running storage endpoint.
 */
import { type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import { useObjectInteraction } from './useObjectInteraction';
import type { TransformController } from '../board/transformController';
import type { Handle } from '../../shared/geometry';

/** The eight resize handles, corner-first (same order as a sketch). */
const HANDLES: ReadonlyArray<{ key: Handle; x: number; y: number; cursor: string }> = [
  { key: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { key: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { key: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { key: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { key: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { key: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { key: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { key: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
];

const HANDLE_PX = 8;

export interface ImageObjectProps {
  /** The image snapshot (its stored fields drive the state). */
  image: ImageSnap;
  /** Resolved `src` for a `ready` image, or `null` when there is nothing to show. */
  src: string | null;
  /** 0..1 upload progress, for the placeholder's indicator. */
  progress?: number;
  zoom: number;
  selected: boolean;
  editable?: boolean;
  controller: TransformController;
  selection: readonly string[];
  onSelect(id: string, additive: boolean): void;
  /** Retry a failed upload (only offered while it is still *this* client's). */
  onRetry?(id: string): void;
  /** Remove the object from the board (the person's own undo step). */
  onRemove(id: string): void;
  /** Clock for the unfinished check; injectable so a test can be exact. */
  now?: number;
}

export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, src, zoom, selected, onSelect } = props;
  const editable = props.editable ?? true;
  const inverse = zoom > 0 ? 1 / zoom : 1;
  const now = props.now ?? Date.now();
  const id = image.id;
  const status = displayStatus(image, now);

  const interaction = useObjectInteraction({
    id,
    isEditable: () => editable,
    isEditing: () => false,
    getSelection: () => props.selection,
    onSelect: (pressedId, additive) => onSelect(pressedId, additive),
    getController: () => props.controller,
  });

  const width = Math.max(image.width, 1);
  const height = Math.max(image.height, 1);

  const startHandle = (handle: Handle) => (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!editable) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom: capture is skipped; the handlers still fire in order.
    }
    const ids = props.selection.length > 0 ? props.selection : [id];
    props.controller.beginResize(handle, ids, event.clientX, event.clientY);
  };

  const moveHandle = (event: ReactPointerEvent<HTMLElement>) => {
    if (!props.controller.isActive()) return;
    event.stopPropagation();
    props.controller.resize(event.clientX, event.clientY);
  };

  const endHandle = (event: ReactPointerEvent<HTMLElement>) => {
    if (!props.controller.isActive()) return;
    event.stopPropagation();
    props.controller.end();
  };

  const lone = selected && props.selection.length <= 1;
  const showHandles = status === 'ready' && lone && editable;

  return (
    <div
      role="group"
      aria-label="Image"
      data-testid="image"
      data-image-id={id}
      data-status={status}
      data-selected={selected ? 'true' : 'false'}
      className={selected ? 'image image-selected' : 'image'}
      style={{
        position: 'absolute',
        left: `${image.x}px`,
        top: `${image.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        outline: selected ? `${2 * inverse}px solid #2f6fed` : 'none',
      }}
      onPointerDown={interaction.onPointerDown}
      onPointerMove={interaction.onPointerMove}
      onPointerUp={interaction.onPointerEnd}
      onPointerCancel={interaction.onPointerEnd}
    >
      {status === 'ready' && src !== null ? (
        <img
          src={src}
          alt="Board image"
          data-testid="image-img"
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {status === 'uploading' ? (
        <div className="image-placeholder" data-testid="image-loading" aria-label="Image upload in progress">
          <span className="image-progress-text">
            {Math.round((props.progress ?? 0) * 100)}%
          </span>
        </div>
      ) : null}

      {status === 'failed' ? (
        <div className="image-placeholder image-placeholder-error" data-testid="image-failed">
          <span className="image-error-text">Image upload didn't work.</span>
          <div className="image-placeholder-actions" style={{ pointerEvents: 'auto' }}>
            <button
              type="button"
              data-testid="image-retry"
              onClick={(event) => {
                event.stopPropagation();
                props.onRetry?.(id);
              }}
            >
              Retry
            </button>
            <button
              type="button"
              data-testid="image-remove"
              onClick={(event) => {
                event.stopPropagation();
                props.onRemove(id);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}

      {status === 'unfinished' ? (
        <div className="image-placeholder image-placeholder-error" data-testid="image-unfinished">
          <span className="image-error-text">Image upload didn't finish.</span>
          <div className="image-placeholder-actions" style={{ pointerEvents: 'auto' }}>
            <button
              type="button"
              data-testid="image-remove"
              onClick={(event) => {
                event.stopPropagation();
                props.onRemove(id);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}

      {showHandles
        ? HANDLES.map((handle) => {
            const size = HANDLE_PX * inverse;
            const cx = handle.x * width;
            const cy = handle.y * height;
            return (
              <div
                key={handle.key}
                data-testid={`image-handle-${handle.key}`}
                data-handle={handle.key}
                className="image-resize-handle"
                style={{
                  position: 'absolute',
                  left: `${cx - size / 2}px`,
                  top: `${cy - size / 2}px`,
                  width: `${size}px`,
                  height: `${size}px`,
                  background: '#ffffff',
                  border: `${inverse}px solid #2f6fed`,
                  boxSizing: 'border-box',
                  pointerEvents: 'all',
                  cursor: handle.cursor,
                  touchAction: 'none',
                }}
                onPointerDown={startHandle(handle.key)}
                onPointerMove={moveHandle}
                onPointerUp={endHandle}
                onPointerCancel={endHandle}
                onLostPointerCapture={endHandle}
              />
            );
          })
        : null}
    </div>
  );
}