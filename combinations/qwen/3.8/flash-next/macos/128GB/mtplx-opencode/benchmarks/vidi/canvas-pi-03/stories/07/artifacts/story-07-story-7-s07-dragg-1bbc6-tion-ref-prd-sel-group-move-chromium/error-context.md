# Page snapshot

```yaml
- generic [ref=e3]:
  - button "Share" [ref=e4] [cursor=pointer]
  - generic [ref=e5]:
    - generic:
      - group "Sticky note" [ref=e6]:
        - generic [ref=e7]: g2
      - group "Sticky note" [active] [ref=e8]:
        - generic [ref=e9]: g1
  - toolbar "Tools" [ref=e10]:
    - button "Sticky note" [ref=e11] [cursor=pointer]: ▢
  - toolbar "Note options" [ref=e13]:
    - button "Yellow colour" [pressed] [ref=e14] [cursor=pointer]
    - button "Orange colour" [ref=e15] [cursor=pointer]
    - button "Green colour" [ref=e16] [cursor=pointer]
    - button "Blue colour" [ref=e17] [cursor=pointer]
    - button "Pink colour" [ref=e18] [cursor=pointer]
    - button "Violet colour" [ref=e19] [cursor=pointer]
    - button "Delete note" [ref=e20] [cursor=pointer]: 🗑
  - group "1 selected" [ref=e21]:
    - generic [ref=e22]: "1"
    - button "Delete 1 selected" [ref=e23] [cursor=pointer]:
      - img [ref=e24]
    - generic [ref=e26]: drag a handle
  - generic [ref=e27]:
    - button "Zoom out" [ref=e28] [cursor=pointer]: −
    - status "Zoom level" [ref=e29]: 100%
    - button "Zoom in" [ref=e30] [cursor=pointer]: +
    - button "Reset view" [ref=e31] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
```