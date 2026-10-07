import * as React from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import type { Size, Camera } from './canvas/camera';
import { useVidi6TestHook } from './testHooks';

export default function App(): React.JSX.Element {
  const [viewportSize, setViewportSize] = React.useState<Size>({ width: 1280, height: 800 });

  // ResizeObserver for viewport size changes
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setViewportSize({ width, height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hook = useCamera(viewportSize);

  // Test hook: window.__vidi6.setCamera() → updates the camera state
  useVidi6TestHook(hook.setRawCamera);

  // Keyboard shortcuts at window level
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;

      switch (e.key) {
        case '=':
        case '+':
        case 'Equal':
          e.preventDefault();
          hook.zoomIn();
          break;
        case '-':
        case 'Minus':
          e.preventDefault();
          hook.zoomOut();
          break;
        case '0':
          e.preventDefault();
          hook.reset();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hook]);

  return (
    <div ref={rootRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <BoardViewport camera={hook.camera} useCameraHook={hook}>
        {/* World-layer children rendered here */}
      </BoardViewport>
      <ZoomControls
        zoomPercent={hook.percent}
        canZoomIn={hook.canZoomIn}
        canZoomOut={hook.canZoomOut}
        onZoomIn={hook.zoomIn}
        onZoomOut={hook.zoomOut}
        onReset={hook.reset}
      />
      <NavigationHint visible={hook.hasNavigated} />
    </div>
  );
}
