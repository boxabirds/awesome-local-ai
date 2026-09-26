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
      - button "Sticky note" [ref=e14] [cursor=pointer]:
        - img [ref=e15]
      - generic [ref=e19]:
        - button "Undo" [ref=e20] [cursor=pointer]:
          - img [ref=e21]
        - button "Redo" [disabled] [ref=e24]:
          - img [ref=e25]
    - generic [ref=e28]:
      - button "Zoom out" [ref=e29] [cursor=pointer]: −
      - status [ref=e30]: 64%
      - button "Zoom in" [ref=e31] [cursor=pointer]: +
      - button "Reset view" [ref=e32] [cursor=pointer]
    - button "Share" [ref=e34] [cursor=pointer]
```