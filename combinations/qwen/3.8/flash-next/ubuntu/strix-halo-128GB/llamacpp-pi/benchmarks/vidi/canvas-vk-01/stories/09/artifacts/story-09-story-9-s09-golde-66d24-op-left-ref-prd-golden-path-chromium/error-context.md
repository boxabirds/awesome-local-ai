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
  - group "Text" [ref=e15]:
    - textbox [active] [ref=e17]
  - generic:
    - button "Resize right" [ref=e18]
    - button "Resize left" [ref=e19]
  - group "Zoom controls" [ref=e20]:
    - button "Zoom out" [ref=e21] [cursor=pointer]: −
    - status [ref=e22]: 100%
    - button "Zoom in" [ref=e23] [cursor=pointer]: +
    - button "Reset view" [ref=e24] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e26] [cursor=pointer]
```