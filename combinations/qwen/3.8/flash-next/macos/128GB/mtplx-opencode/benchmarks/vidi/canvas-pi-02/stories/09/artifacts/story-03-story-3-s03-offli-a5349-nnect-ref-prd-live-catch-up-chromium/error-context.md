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
      - button "Sticky note" [ref=e24] [cursor=pointer]:
        - img [ref=e25]
      - button "Undo" [disabled] [ref=e28] [cursor=pointer]:
        - img [ref=e29]
      - button "Redo" [disabled] [ref=e32] [cursor=pointer]:
        - img [ref=e33]
  - generic [ref=e36]:
    - button "Zoom out" [ref=e37] [cursor=pointer]: −
    - status [ref=e38]: 100%
    - button "Zoom in" [ref=e39] [cursor=pointer]: +
    - button "Reset view" [ref=e40] [cursor=pointer]
  - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
```