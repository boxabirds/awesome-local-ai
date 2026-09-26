# Page snapshot

```yaml
- generic [active]:
  - generic:
    - group "Text:" [ref=e2]
    - generic:
      - button "Resize right" [ref=e3]
      - button "Resize left" [ref=e4]
    - toolbar "Text actions" [ref=e6]:
      - button "Text size S" [ref=e7] [cursor=pointer]: S
      - button "Text size M" [pressed] [ref=e8] [cursor=pointer]: M
      - button "Text size L" [ref=e9] [cursor=pointer]: L
      - button "Text size XL" [ref=e10] [cursor=pointer]: XL
      - button "Delete text" [ref=e11] [cursor=pointer]: Delete
    - generic [ref=e12]:
      - button "Select (V)" [pressed] [ref=e13] [cursor=pointer]:
        - img [ref=e14]
      - button "Text (T)" [ref=e16] [cursor=pointer]:
        - img [ref=e17]
      - button "Sticky note" [ref=e19] [cursor=pointer]:
        - img [ref=e20]
      - generic [ref=e24]:
        - button "Undo" [ref=e25] [cursor=pointer]:
          - img [ref=e26]
        - button "Redo" [disabled] [ref=e29]:
          - img [ref=e30]
    - generic [ref=e33]:
      - button "Zoom out" [ref=e34] [cursor=pointer]: −
      - status [ref=e35]: 100%
      - button "Zoom in" [ref=e36] [cursor=pointer]: +
      - button "Reset view" [ref=e37] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    - button "Share" [ref=e39] [cursor=pointer]
```