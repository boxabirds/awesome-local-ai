# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic:
      - generic:
        - img
      - img [ref=e6]
      - img
  - toolbar "Tools" [ref=e8]:
    - button "Select (V)" [pressed] [ref=e9] [cursor=pointer]:
      - img [ref=e10]
    - button "Sticky note" [ref=e12] [cursor=pointer]:
      - img [ref=e13]
    - button "Image" [ref=e16] [cursor=pointer]:
      - img [ref=e17]
    - button "Text (T)" [ref=e21] [cursor=pointer]:
      - img [ref=e22]:
        - generic [ref=e23]: T
    - 'button "Shape: rect (S)" [ref=e25] [cursor=pointer]':
      - img [ref=e26]
    - button "Pen (P)" [ref=e28] [cursor=pointer]:
      - img [ref=e29]
    - button "Connector (L)" [ref=e32] [cursor=pointer]:
      - img [ref=e33]
    - button "Undo" [ref=e36] [cursor=pointer]:
      - img [ref=e37]
    - button "Redo" [disabled] [ref=e40] [cursor=pointer]:
      - img [ref=e41]
  - generic [ref=e44]:
    - button "Zoom out" [ref=e45] [cursor=pointer]: −
    - status [ref=e46]: 100%
    - button "Zoom in" [ref=e47] [cursor=pointer]: +
    - button "Reset view" [ref=e48] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e49] [cursor=pointer]
```