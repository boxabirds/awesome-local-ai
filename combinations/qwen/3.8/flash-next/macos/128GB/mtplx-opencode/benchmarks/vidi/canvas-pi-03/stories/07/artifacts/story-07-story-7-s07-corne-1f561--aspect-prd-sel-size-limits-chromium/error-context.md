# Page snapshot

```yaml
- generic [ref=e3]:
  - button "Share" [ref=e4] [cursor=pointer]
  - group "Sticky note" [active] [ref=e6]:
    - generic [ref=e7]: grow
  - toolbar "Tools" [ref=e8]:
    - button "Sticky note" [ref=e9] [cursor=pointer]: ▢
  - toolbar "Note options" [ref=e11]:
    - button "Yellow colour" [pressed] [ref=e12] [cursor=pointer]
    - button "Orange colour" [ref=e13] [cursor=pointer]
    - button "Green colour" [ref=e14] [cursor=pointer]
    - button "Blue colour" [ref=e15] [cursor=pointer]
    - button "Pink colour" [ref=e16] [cursor=pointer]
    - button "Violet colour" [ref=e17] [cursor=pointer]
    - button "Delete note" [ref=e18] [cursor=pointer]: 🗑
  - group "1 selected" [ref=e19]:
    - generic [ref=e20]: "1"
    - button "Delete 1 selected" [ref=e21] [cursor=pointer]:
      - img [ref=e22]
    - generic [ref=e24]: drag a handle
  - generic [ref=e25]:
    - button "Zoom out" [ref=e26] [cursor=pointer]: −
    - status "Zoom level" [ref=e27]: 100%
    - button "Zoom in" [ref=e28] [cursor=pointer]: +
    - button "Reset view" [ref=e29] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
```