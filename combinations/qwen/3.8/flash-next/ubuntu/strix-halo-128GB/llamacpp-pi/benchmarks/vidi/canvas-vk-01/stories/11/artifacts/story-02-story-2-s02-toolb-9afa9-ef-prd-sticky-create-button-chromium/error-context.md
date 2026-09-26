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
    - button "Undo" [ref=e17] [cursor=pointer]:
      - generic [ref=e18]: ↩
    - button "Redo" [disabled] [ref=e19] [cursor=pointer]:
      - generic [ref=e20]: ↪
  - group "Sticky note" [ref=e22]:
    - textbox [active] [ref=e24]: centre
  - generic:
    - button "Resize top-left" [ref=e25]
    - button "Resize top" [ref=e26]
    - button "Resize top-right" [ref=e27]
    - button "Resize right" [ref=e28]
    - button "Resize bottom-right" [ref=e29]
    - button "Resize bottom" [ref=e30]
    - button "Resize bottom-left" [ref=e31]
    - button "Resize left" [ref=e32]
  - group "Zoom controls" [ref=e33]:
    - button "Zoom out" [ref=e34] [cursor=pointer]: −
    - status [ref=e35]: 100%
    - button "Zoom in" [ref=e36] [cursor=pointer]: +
    - button "Reset view" [ref=e37] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e39] [cursor=pointer]
```