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
    - button "Undo" [ref=e10] [cursor=pointer]:
      - generic [ref=e11]: ↩
    - button "Redo" [disabled] [ref=e12] [cursor=pointer]:
      - generic [ref=e13]: ↪
  - group "Sticky note" [ref=e15]:
    - textbox [active] [ref=e17]: centre
  - generic:
    - button "Resize top-left" [ref=e18]
    - button "Resize top" [ref=e19]
    - button "Resize top-right" [ref=e20]
    - button "Resize right" [ref=e21]
    - button "Resize bottom-right" [ref=e22]
    - button "Resize bottom" [ref=e23]
    - button "Resize bottom-left" [ref=e24]
    - button "Resize left" [ref=e25]
  - group "Zoom controls" [ref=e26]:
    - button "Zoom out" [ref=e27] [cursor=pointer]: −
    - status [ref=e28]: 100%
    - button "Zoom in" [ref=e29] [cursor=pointer]: +
    - button "Reset view" [ref=e30] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e32] [cursor=pointer]
```