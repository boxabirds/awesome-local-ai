# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - button "Sticky note" [ref=e4] [cursor=pointer]:
      - generic [ref=e5]: 📌
    - button "Undo" [ref=e6] [cursor=pointer]:
      - generic [ref=e7]: ↩
    - button "Redo" [disabled] [ref=e8] [cursor=pointer]:
      - generic [ref=e9]: ↪
  - group "Sticky note" [ref=e11]:
    - textbox [active] [ref=e13]: typed
  - generic:
    - button "Resize top-left" [ref=e14]
    - button "Resize top" [ref=e15]
    - button "Resize top-right" [ref=e16]
    - button "Resize right" [ref=e17]
    - button "Resize bottom-right" [ref=e18]
    - button "Resize bottom" [ref=e19]
    - button "Resize bottom-left" [ref=e20]
    - button "Resize left" [ref=e21]
  - group "Zoom controls" [ref=e22]:
    - button "Zoom out" [ref=e23] [cursor=pointer]: −
    - status [ref=e24]: 100%
    - button "Zoom in" [ref=e25] [cursor=pointer]: +
    - button "Reset view" [ref=e26] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e28] [cursor=pointer]
```