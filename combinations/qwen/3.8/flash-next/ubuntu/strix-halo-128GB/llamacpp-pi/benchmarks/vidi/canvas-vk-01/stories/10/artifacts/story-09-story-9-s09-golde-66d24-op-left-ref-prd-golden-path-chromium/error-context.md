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
  - group "Text" [ref=e20]:
    - textbox [active] [ref=e22]
  - generic:
    - button "Resize right" [ref=e23]
    - button "Resize left" [ref=e24]
  - group "Zoom controls" [ref=e25]:
    - button "Zoom out" [ref=e26] [cursor=pointer]: −
    - status [ref=e27]: 100%
    - button "Zoom in" [ref=e28] [cursor=pointer]: +
    - button "Reset view" [ref=e29] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e31] [cursor=pointer]
```