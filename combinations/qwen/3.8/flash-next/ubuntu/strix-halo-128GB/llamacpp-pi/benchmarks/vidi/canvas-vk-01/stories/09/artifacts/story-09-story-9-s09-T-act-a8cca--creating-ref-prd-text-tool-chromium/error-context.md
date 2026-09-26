# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - button "Select" [ref=e4] [cursor=pointer]:
      - generic [ref=e5]: ↑
    - button "Text" [pressed] [ref=e6] [cursor=pointer]:
      - generic [ref=e7]: T
    - button "Sticky note" [ref=e8] [cursor=pointer]:
      - generic [ref=e9]: 📌
    - button "Undo" [disabled] [ref=e10] [cursor=pointer]:
      - generic [ref=e11]: ↩
    - button "Redo" [disabled] [ref=e12] [cursor=pointer]:
      - generic [ref=e13]: ↪
  - group "Zoom controls" [ref=e16]:
    - button "Zoom out" [ref=e17] [cursor=pointer]: −
    - status [ref=e18]: 100%
    - button "Zoom in" [ref=e19] [cursor=pointer]: +
    - button "Reset view" [ref=e20] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e22] [cursor=pointer]
```