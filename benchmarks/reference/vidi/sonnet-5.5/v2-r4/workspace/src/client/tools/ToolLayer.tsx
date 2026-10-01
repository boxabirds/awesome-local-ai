import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/**
 * A transparent layer over the board that owns every pointer gesture while a creating tool is active, so a drag that
 * starts over an existing object never moves it. Wheel and pinch still reach the board's camera.
 */
export function ToolLayer(props: {
  testId: string;
  onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void;
  onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void;
  onPointerUp(e: ReactPointerEvent<HTMLDivElement>): void;
  onPointerCancel(e: ReactPointerEvent<HTMLDivElement>): void;
  onPointerLeave?(e: ReactPointerEvent<HTMLDivElement>): void;
  cursor?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const forward = (e: WheelEvent) => {
      e.preventDefault();
      const target = document.querySelector('[data-testid="board-viewport"]');
      target?.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          clientX: e.clientX,
          clientY: e.clientY,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    el.addEventListener('wheel', forward, { passive: false });
    return () => el.removeEventListener('wheel', forward);
  }, []);

  return (
    <div
      ref={ref}
      data-testid={props.testId}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        props.onPointerDown(e);
      }}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onPointerLeave={props.onPointerLeave}
      onLostPointerCapture={props.onPointerCancel}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 15, cursor: props.cursor ?? 'crosshair', touchAction: 'none' }}
    >
      {props.children}
    </div>
  );
}
