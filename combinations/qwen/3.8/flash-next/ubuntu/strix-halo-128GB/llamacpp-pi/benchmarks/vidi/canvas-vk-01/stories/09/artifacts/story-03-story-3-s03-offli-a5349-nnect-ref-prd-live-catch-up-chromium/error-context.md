# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - button "Select" [pressed] [ref=e4] [cursor=pointer]:
      - generic [ref=e5]: ↑
    - button "Text" [ref=e6] [cursor=pointer]:
      - generic [ref=e7]: T
    - button "Sticky note" [ref=e8] [cursor=pointer]:
      - generic [ref=e9]: 📌
    - button "Undo" [disabled] [ref=e10] [cursor=pointer]:
      - generic [ref=e11]: ↩
    - button "Redo" [disabled] [ref=e12] [cursor=pointer]:
      - generic [ref=e13]: ↪
  - group "Zoom controls" [ref=e15]:
    - button "Zoom out" [ref=e16] [cursor=pointer]: −
    - status [ref=e17]: 100%
    - button "Zoom in" [ref=e18] [cursor=pointer]: +
    - button "Reset view" [ref=e19] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e21] [cursor=pointer]
```