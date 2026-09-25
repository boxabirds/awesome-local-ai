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
    - button "Text (T)" [ref=e16] [cursor=pointer]:
      - img [ref=e17]:
        - generic [ref=e18]: T
    - 'button "Shape: rect (S)" [ref=e20] [cursor=pointer]':
      - img [ref=e21]
    - button "Connector (L)" [ref=e23] [cursor=pointer]:
      - img [ref=e24]
    - button "Undo" [ref=e27] [cursor=pointer]:
      - img [ref=e28]
    - button "Redo" [disabled] [ref=e31] [cursor=pointer]:
      - img [ref=e32]
  - generic [ref=e35]:
    - button "Zoom out" [ref=e36] [cursor=pointer]: −
    - status [ref=e37]: 100%
    - button "Zoom in" [ref=e38] [cursor=pointer]: +
    - button "Reset view" [ref=e39] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e40] [cursor=pointer]
```