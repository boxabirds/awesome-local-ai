# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - generic:
        - group "Sticky note" [ref=e6]:
          - generic [ref=e7]: still
        - group "Sticky note" [active] [ref=e8]:
          - generic [ref=e9]: mover
          - toolbar "Note actions" [ref=e11]:
            - button "Yellow colour" [pressed] [ref=e12] [cursor=pointer]
            - button "Orange colour" [ref=e13] [cursor=pointer]
            - button "Green colour" [ref=e14] [cursor=pointer]
            - button "Blue colour" [ref=e15] [cursor=pointer]
            - button "Pink colour" [ref=e16] [cursor=pointer]
            - button "Violet colour" [ref=e17] [cursor=pointer]
            - button "Delete note" [ref=e18] [cursor=pointer]: 🗑
    - toolbar "Board tools" [ref=e19]:
      - button "Sticky note" [ref=e20] [cursor=pointer]:
        - generic [ref=e21]: 📝
    - generic [ref=e22]:
      - button "Zoom out" [ref=e23] [cursor=pointer]: −
      - status [ref=e24]: 100%
      - button "Zoom in" [ref=e25] [cursor=pointer]: +
      - button "Reset view" [ref=e26] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e29] [cursor=pointer]
```