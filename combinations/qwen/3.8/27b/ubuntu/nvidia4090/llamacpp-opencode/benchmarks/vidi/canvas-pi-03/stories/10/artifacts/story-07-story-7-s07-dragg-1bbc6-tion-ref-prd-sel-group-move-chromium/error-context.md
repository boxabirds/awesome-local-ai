# Page snapshot

```yaml
- generic:
  - generic:
    - group "Sticky note" [ref=e2]:
      - textbox [active] [ref=e4]
    - generic:
      - button "Resize top-left" [ref=e5]
      - button "Resize top" [ref=e6]
      - button "Resize top-right" [ref=e7]
      - button "Resize right" [ref=e8]
      - button "Resize bottom-right" [ref=e9]
      - button "Resize bottom" [ref=e10]
      - button "Resize bottom-left" [ref=e11]
      - button "Resize left" [ref=e12]
    - generic [ref=e13]:
      - button "Select (V)" [pressed] [ref=e14] [cursor=pointer]:
        - img [ref=e15]
      - button "Text (T)" [ref=e17] [cursor=pointer]:
        - img [ref=e18]
      - button "Shape (S)" [ref=e20] [cursor=pointer]:
        - img [ref=e21]
      - button "Connector (L)" [ref=e24] [cursor=pointer]:
        - img [ref=e25]
      - button "Sticky note" [ref=e28] [cursor=pointer]:
        - img [ref=e29]
      - generic [ref=e33]:
        - button "Undo" [ref=e34] [cursor=pointer]:
          - img [ref=e35]
        - button "Redo" [disabled] [ref=e38]:
          - img [ref=e39]
    - generic [ref=e42]:
      - button "Zoom out" [ref=e43] [cursor=pointer]: −
      - status [ref=e44]: 100%
      - button "Zoom in" [ref=e45] [cursor=pointer]: +
      - button "Reset view" [ref=e46] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    - button "Share" [ref=e48] [cursor=pointer]
```