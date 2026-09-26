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
    - button "Sticky note" [ref=e13] [cursor=pointer]:
      - generic [ref=e14]: 📌
    - button "Undo" [ref=e15] [cursor=pointer]:
      - generic [ref=e16]: ↩
    - button "Redo" [disabled] [ref=e17] [cursor=pointer]:
      - generic [ref=e18]: ↪
  - group "Sticky note" [ref=e20]:
    - textbox [active] [ref=e22]: centre
  - generic:
    - button "Resize top-left" [ref=e23]
    - button "Resize top" [ref=e24]
    - button "Resize top-right" [ref=e25]
    - button "Resize right" [ref=e26]
    - button "Resize bottom-right" [ref=e27]
    - button "Resize bottom" [ref=e28]
    - button "Resize bottom-left" [ref=e29]
    - button "Resize left" [ref=e30]
  - group "Zoom controls" [ref=e31]:
    - button "Zoom out" [ref=e32] [cursor=pointer]: −
    - status [ref=e33]: 100%
    - button "Zoom in" [ref=e34] [cursor=pointer]: +
    - button "Reset view" [ref=e35] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e37] [cursor=pointer]
```