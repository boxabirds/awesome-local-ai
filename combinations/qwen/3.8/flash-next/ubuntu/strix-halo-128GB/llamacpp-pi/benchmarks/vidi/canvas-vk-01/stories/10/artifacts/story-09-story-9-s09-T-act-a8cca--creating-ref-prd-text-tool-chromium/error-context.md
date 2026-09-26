# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - button "Select" [ref=e4] [cursor=pointer]:
      - generic [ref=e5]: ↑
    - button "Text" [pressed] [ref=e6] [cursor=pointer]:
      - generic [ref=e7]: T
    - button "Shape" [ref=e9] [cursor=pointer]:
      - generic [ref=e10]: □
    - button "Connector" [ref=e11] [cursor=pointer]:
      - generic [ref=e12]: →
    - button "Sticky note" [ref=e13] [cursor=pointer]:
      - generic [ref=e14]: 📌
    - button "Undo" [disabled] [ref=e15] [cursor=pointer]:
      - generic [ref=e16]: ↩
    - button "Redo" [disabled] [ref=e17] [cursor=pointer]:
      - generic [ref=e18]: ↪
  - group "Zoom controls" [ref=e21]:
    - button "Zoom out" [ref=e22] [cursor=pointer]: −
    - status [ref=e23]: 100%
    - button "Zoom in" [ref=e24] [cursor=pointer]: +
    - button "Reset view" [ref=e25] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e27] [cursor=pointer]
```