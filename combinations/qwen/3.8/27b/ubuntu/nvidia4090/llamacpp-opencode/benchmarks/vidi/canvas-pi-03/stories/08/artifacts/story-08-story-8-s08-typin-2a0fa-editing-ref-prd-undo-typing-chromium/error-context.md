# Page snapshot

```yaml
- generic [active]:
  - generic:
    - group "Sticky note" [ref=e2]
    - generic:
      - button "Resize top-left" [ref=e4]
      - button "Resize top" [ref=e5]
      - button "Resize top-right" [ref=e6]
      - button "Resize right" [ref=e7]
      - button "Resize bottom-right" [ref=e8]
      - button "Resize bottom" [ref=e9]
      - button "Resize bottom-left" [ref=e10]
      - button "Resize left" [ref=e11]
    - toolbar "Note actions" [ref=e13]:
      - button "Yellow colour" [pressed] [ref=e14] [cursor=pointer]
      - button "Orange colour" [ref=e15] [cursor=pointer]
      - button "Green colour" [ref=e16] [cursor=pointer]
      - button "Blue colour" [ref=e17] [cursor=pointer]
      - button "Pink colour" [ref=e18] [cursor=pointer]
      - button "Violet colour" [ref=e19] [cursor=pointer]
      - button "Delete note" [ref=e20] [cursor=pointer]:
        - img [ref=e21]
    - generic [ref=e25]:
      - button "Sticky note" [ref=e26] [cursor=pointer]:
        - img [ref=e27]
      - generic [ref=e31]:
        - button "Undo" [ref=e32] [cursor=pointer]:
          - img [ref=e33]
        - button "Redo" [ref=e36] [cursor=pointer]:
          - img [ref=e37]
    - generic [ref=e40]:
      - button "Zoom out" [ref=e41] [cursor=pointer]: −
      - status [ref=e42]: 100%
      - button "Zoom in" [ref=e43] [cursor=pointer]: +
      - button "Reset view" [ref=e44] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    - button "Share" [ref=e46] [cursor=pointer]
```