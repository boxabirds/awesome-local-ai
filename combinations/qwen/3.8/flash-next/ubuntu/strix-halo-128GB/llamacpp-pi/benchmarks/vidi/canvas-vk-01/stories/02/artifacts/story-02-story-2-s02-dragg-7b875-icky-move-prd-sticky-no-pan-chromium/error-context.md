# Page snapshot

```yaml
- generic [ref=e2]:
  - button "Sticky note" [ref=e4] [cursor=pointer]:
    - generic [ref=e5]: 📌
  - generic [ref=e6]:
    - generic:
      - group "Sticky note" [ref=e7]:
        - generic [ref=e8]: still
      - group "Sticky note" [ref=e9]:
        - generic [ref=e10]: mover
  - generic [ref=e12]:
    - button "Yellow colour" [pressed] [ref=e13] [cursor=pointer]
    - button "Orange colour" [ref=e14] [cursor=pointer]
    - button "Green colour" [ref=e15] [cursor=pointer]
    - button "Blue colour" [ref=e16] [cursor=pointer]
    - button "Pink colour" [ref=e17] [cursor=pointer]
    - button "Violet colour" [ref=e18] [cursor=pointer]
    - button "Delete note" [ref=e19] [cursor=pointer]: 🗑
  - group "Zoom controls" [ref=e20]:
    - button "Zoom out" [ref=e21] [cursor=pointer]: −
    - status [ref=e22]: 100%
    - button "Zoom in" [ref=e23] [cursor=pointer]: +
    - button "Reset view" [ref=e24] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
```