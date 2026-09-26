# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic:
      - img
      - group "Sticky note" [ref=e5]:
        - generic [ref=e6]: still
      - group "Sticky note" [active] [ref=e7]:
        - generic [ref=e8]: mover
        - toolbar "Note tools" [ref=e10]:
          - button "Yellow colour" [pressed] [ref=e11] [cursor=pointer]
          - button "Orange colour" [ref=e12] [cursor=pointer]
          - button "Green colour" [ref=e13] [cursor=pointer]
          - button "Blue colour" [ref=e14] [cursor=pointer]
          - button "Pink colour" [ref=e15] [cursor=pointer]
          - button "Violet colour" [ref=e16] [cursor=pointer]
          - button "Delete note" [ref=e17] [cursor=pointer]:
            - img [ref=e18]
  - button "Sticky note" [ref=e21] [cursor=pointer]:
    - img [ref=e22]
  - generic [ref=e24]:
    - button "Zoom out" [ref=e25] [cursor=pointer]: −
    - status [ref=e26]: 100%
    - button "Zoom in" [ref=e27] [cursor=pointer]: +
    - button "Reset view" [ref=e28] [cursor=pointer]
  - note: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
```