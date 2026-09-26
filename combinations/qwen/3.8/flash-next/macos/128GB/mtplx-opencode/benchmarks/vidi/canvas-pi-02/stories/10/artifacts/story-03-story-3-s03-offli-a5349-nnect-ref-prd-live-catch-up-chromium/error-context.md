# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - button "Share" [ref=e6] [cursor=pointer]
  - generic [ref=e7]:
    - generic [ref=e8]:
      - generic:
        - img
    - generic [ref=e9]:
      - generic [ref=e11]:
        - img "Curious Otter" [ref=e12]: C
        - img "Curious Otter 2, you" [ref=e13]: C
      - generic [ref=e14]:
        - generic [ref=e15]: Curious Otter
        - button "Rename" [ref=e16]
    - generic [ref=e17]:
      - button "Select (V)" [pressed] [ref=e18] [cursor=pointer]:
        - img [ref=e19]
      - button "Text (T)" [ref=e21] [cursor=pointer]:
        - img [ref=e22]:
          - generic [ref=e23]: T
      - button "Shape (S)" [ref=e24] [cursor=pointer]:
        - img [ref=e25]
      - button "Connector (L)" [ref=e27] [cursor=pointer]:
        - img [ref=e28]
      - button "Sticky note" [ref=e31] [cursor=pointer]:
        - img [ref=e32]
      - button "Undo" [disabled] [ref=e35] [cursor=pointer]:
        - img [ref=e36]
      - button "Redo" [disabled] [ref=e39] [cursor=pointer]:
        - img [ref=e40]
  - generic [ref=e43]:
    - button "Zoom out" [ref=e44] [cursor=pointer]: −
    - status [ref=e45]: 100%
    - button "Zoom in" [ref=e46] [cursor=pointer]: +
    - button "Reset view" [ref=e47] [cursor=pointer]
  - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
```