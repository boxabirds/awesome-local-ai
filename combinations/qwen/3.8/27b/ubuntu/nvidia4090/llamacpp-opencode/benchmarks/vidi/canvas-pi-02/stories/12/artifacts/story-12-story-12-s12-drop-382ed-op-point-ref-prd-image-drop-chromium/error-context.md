# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic:
      - generic:
        - img
      - img "Image" [ref=e5]
      - img "Image" [ref=e6]
      - img
  - toolbar "Tools" [ref=e7]:
    - button "Select (V)" [pressed] [ref=e8] [cursor=pointer]:
      - img [ref=e9]
    - button "Sticky note" [ref=e11] [cursor=pointer]:
      - img [ref=e12]
    - button "Image" [ref=e15] [cursor=pointer]:
      - img [ref=e16]
    - button "Text (T)" [ref=e20] [cursor=pointer]:
      - img [ref=e21]:
        - generic [ref=e22]: T
    - 'button "Shape: rect (S)" [ref=e24] [cursor=pointer]':
      - img [ref=e25]
    - button "Pen (P)" [ref=e27] [cursor=pointer]:
      - img [ref=e28]
    - button "Connector (L)" [ref=e31] [cursor=pointer]:
      - img [ref=e32]
    - button "Undo" [ref=e35] [cursor=pointer]:
      - img [ref=e36]
    - button "Redo" [disabled] [ref=e39] [cursor=pointer]:
      - img [ref=e40]
  - generic [ref=e43]:
    - button "Zoom out" [ref=e44] [cursor=pointer]: −
    - status [ref=e45]: 100%
    - button "Zoom in" [ref=e46] [cursor=pointer]: +
    - button "Reset view" [ref=e47] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e48] [cursor=pointer]
```