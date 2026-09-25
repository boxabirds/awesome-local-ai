# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic:
      - generic:
        - img
      - img
  - toolbar "Tools" [ref=e5]:
    - button "Select (V)" [pressed] [ref=e6] [cursor=pointer]:
      - img [ref=e7]
    - button "Sticky note" [ref=e9] [cursor=pointer]:
      - img [ref=e10]
    - button "Image" [ref=e13] [cursor=pointer]:
      - img [ref=e14]
    - button "Text (T)" [ref=e18] [cursor=pointer]:
      - img [ref=e19]:
        - generic [ref=e20]: T
    - 'button "Shape: rect (S)" [ref=e22] [cursor=pointer]':
      - img [ref=e23]
    - button "Pen (P)" [ref=e25] [cursor=pointer]:
      - img [ref=e26]
    - button "Connector (L)" [ref=e29] [cursor=pointer]:
      - img [ref=e30]
    - button "Undo" [disabled] [ref=e33] [cursor=pointer]:
      - img [ref=e34]
    - button "Redo" [disabled] [ref=e37] [cursor=pointer]:
      - img [ref=e38]
  - generic [ref=e41]:
    - button "Zoom out" [active] [ref=e42] [cursor=pointer]: −
    - status [ref=e43]: 64%
    - button "Zoom in" [ref=e44] [cursor=pointer]: +
    - button "Reset view" [ref=e45] [cursor=pointer]
  - button "Share" [ref=e46] [cursor=pointer]
```