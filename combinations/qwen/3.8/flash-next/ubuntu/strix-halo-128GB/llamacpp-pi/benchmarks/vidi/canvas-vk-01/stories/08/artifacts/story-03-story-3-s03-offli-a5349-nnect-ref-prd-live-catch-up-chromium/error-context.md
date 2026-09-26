# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - button "Sticky note" [ref=e4] [cursor=pointer]:
      - generic [ref=e5]: 📌
    - button "Undo" [disabled] [ref=e6] [cursor=pointer]:
      - generic [ref=e7]: ↩
    - button "Redo" [disabled] [ref=e8] [cursor=pointer]:
      - generic [ref=e9]: ↪
  - group "Zoom controls" [ref=e11]:
    - button "Zoom out" [ref=e12] [cursor=pointer]: −
    - status [ref=e13]: 100%
    - button "Zoom in" [ref=e14] [cursor=pointer]: +
    - button "Reset view" [ref=e15] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e17] [cursor=pointer]
```