# Page snapshot

```yaml
- generic [ref=e3]:
  - button "Share" [ref=e4] [cursor=pointer]
  - generic [ref=e5]:
    - generic:
      - group "Sticky note" [ref=e6]:
        - generic [ref=e7]: a1
      - group "Sticky note" [ref=e8]:
        - generic [ref=e9]: b1
      - group "Sticky note" [active] [ref=e10]:
        - generic [ref=e11]: c1
  - toolbar "Tools" [ref=e12]:
    - button "Sticky note" [ref=e13] [cursor=pointer]: ▢
  - toolbar "Note options" [ref=e15]:
    - button "Yellow colour" [pressed] [ref=e16] [cursor=pointer]
    - button "Orange colour" [ref=e17] [cursor=pointer]
    - button "Green colour" [ref=e18] [cursor=pointer]
    - button "Blue colour" [ref=e19] [cursor=pointer]
    - button "Pink colour" [ref=e20] [cursor=pointer]
    - button "Violet colour" [ref=e21] [cursor=pointer]
    - button "Delete note" [ref=e22] [cursor=pointer]: 🗑
  - group "1 selected" [ref=e23]:
    - generic [ref=e24]: "1"
    - button "Delete 1 selected" [ref=e25] [cursor=pointer]:
      - img [ref=e26]
    - generic [ref=e28]: drag a handle
  - generic [ref=e29]:
    - button "Zoom out" [ref=e30] [cursor=pointer]: −
    - status "Zoom level" [ref=e31]: 100%
    - button "Zoom in" [ref=e32] [cursor=pointer]: +
    - button "Reset view" [ref=e33] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
```