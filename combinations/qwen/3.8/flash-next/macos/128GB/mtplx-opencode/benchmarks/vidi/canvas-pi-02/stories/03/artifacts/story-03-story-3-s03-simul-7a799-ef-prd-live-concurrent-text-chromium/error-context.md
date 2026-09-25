# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - group "Sticky note" [ref=e5]:
        - generic [ref=e6]: green
        - generic [ref=e7]:
          - button "Yellow colour" [pressed] [ref=e8] [cursor=pointer]
          - button "Orange colour" [ref=e9] [cursor=pointer]
          - button "Green colour" [ref=e10] [cursor=pointer]
          - button "Blue colour" [ref=e11] [cursor=pointer]
          - button "Pink colour" [ref=e12] [cursor=pointer]
          - button "Violet colour" [ref=e13] [cursor=pointer]
          - button "Delete note" [ref=e14] [cursor=pointer]:
            - img [ref=e15]
      - generic:
        - img
    - button "Sticky note" [ref=e18] [cursor=pointer]:
      - img [ref=e19]
  - generic [ref=e22]:
    - button "Zoom out" [ref=e23] [cursor=pointer]: −
    - status [ref=e24]: 100%
    - button "Zoom in" [ref=e25] [cursor=pointer]: +
    - button "Reset view" [ref=e26] [cursor=pointer]
  - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
```