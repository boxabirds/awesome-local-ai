# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - button "Select" [pressed] [ref=e4] [cursor=pointer]:
      - generic [ref=e5]: ↑
    - button "Text" [ref=e6] [cursor=pointer]:
      - generic [ref=e7]: T
    - button "Shape" [ref=e9] [cursor=pointer]:
      - generic [ref=e10]: □
    - button "Connector" [ref=e11] [cursor=pointer]:
      - generic [ref=e12]: →
    - button "Pen" [ref=e13] [cursor=pointer]:
      - generic [ref=e14]: ✏️
    - button "Sticky note" [ref=e15] [cursor=pointer]:
      - generic [ref=e16]: 📌
    - button "Undo" [disabled] [ref=e17] [cursor=pointer]:
      - generic [ref=e18]: ↩
    - button "Redo" [disabled] [ref=e19] [cursor=pointer]:
      - generic [ref=e20]: ↪
  - group "Zoom controls" [ref=e22]:
    - button "Zoom out" [ref=e23] [cursor=pointer]: −
    - status [ref=e24]: 100%
    - button "Zoom in" [ref=e25] [cursor=pointer]: +
    - button "Reset view" [ref=e26] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e28] [cursor=pointer]
```