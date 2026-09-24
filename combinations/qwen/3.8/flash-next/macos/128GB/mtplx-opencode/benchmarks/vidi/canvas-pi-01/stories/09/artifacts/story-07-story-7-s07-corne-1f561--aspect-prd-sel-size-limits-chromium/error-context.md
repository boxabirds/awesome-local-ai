# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - group "Sticky note" [active] [ref=e6]:
      - generic [ref=e7]: grow
      - toolbar "Note actions" [ref=e9]:
        - button "Yellow colour" [pressed] [ref=e10] [cursor=pointer]
        - button "Orange colour" [ref=e11] [cursor=pointer]
        - button "Green colour" [ref=e12] [cursor=pointer]
        - button "Blue colour" [ref=e13] [cursor=pointer]
        - button "Pink colour" [ref=e14] [cursor=pointer]
        - button "Violet colour" [ref=e15] [cursor=pointer]
        - button "Delete note" [ref=e16] [cursor=pointer]: 🗑
    - toolbar "Board tools" [ref=e17]:
      - button "Select (V)" [pressed] [ref=e18] [cursor=pointer]:
        - generic [ref=e19]: 🖱️
      - button "Text (T)" [ref=e20] [cursor=pointer]:
        - generic [ref=e21]: T
      - button "Sticky note" [ref=e22] [cursor=pointer]:
        - generic [ref=e23]: 📝
      - generic [ref=e24]:
        - button "Undo" [ref=e25] [cursor=pointer]:
          - generic [ref=e26]: ↶
        - button "Redo" [disabled] [ref=e27]:
          - generic [ref=e28]: ↷
    - generic [ref=e29]:
      - button "Zoom out" [ref=e30] [cursor=pointer]: −
      - status [ref=e31]: 100%
      - button "Zoom in" [ref=e32] [cursor=pointer]: +
      - button "Reset view" [ref=e33] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e36] [cursor=pointer]
```