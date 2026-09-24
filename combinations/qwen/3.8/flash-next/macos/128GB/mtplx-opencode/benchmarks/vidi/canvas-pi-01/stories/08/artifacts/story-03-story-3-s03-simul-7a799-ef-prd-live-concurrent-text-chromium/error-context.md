# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - group "Sticky note" [ref=e6]:
      - generic [ref=e7]: rgreen ebdl ue
      - toolbar "Note actions" [ref=e9]:
        - button "Yellow colour" [pressed] [ref=e10] [cursor=pointer]
        - button "Orange colour" [ref=e11] [cursor=pointer]
        - button "Green colour" [ref=e12] [cursor=pointer]
        - button "Blue colour" [ref=e13] [cursor=pointer]
        - button "Pink colour" [ref=e14] [cursor=pointer]
        - button "Violet colour" [ref=e15] [cursor=pointer]
        - button "Delete note" [ref=e16] [cursor=pointer]: 🗑
    - toolbar "Board tools" [ref=e17]:
      - button "Sticky note" [ref=e18] [cursor=pointer]:
        - generic [ref=e19]: 📝
      - generic [ref=e20]:
        - button "Undo" [ref=e21] [cursor=pointer]:
          - generic [ref=e22]: ↶
        - button "Redo" [disabled] [ref=e23]:
          - generic [ref=e24]: ↷
    - generic [ref=e25]:
      - button "Zoom out" [ref=e26] [cursor=pointer]: −
      - status [ref=e27]: 100%
      - button "Zoom in" [ref=e28] [cursor=pointer]: +
      - button "Reset view" [ref=e29] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e32] [cursor=pointer]
```