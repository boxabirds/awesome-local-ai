# Page snapshot

```yaml
- generic [active]:
  - generic:
    - group "Sticky note" [ref=e2]
    - generic [ref=e4]:
      - button "Select (V)" [pressed] [ref=e5] [cursor=pointer]:
        - img [ref=e6]
      - button "Text (T)" [ref=e8] [cursor=pointer]:
        - img [ref=e9]
      - button "Sticky note" [ref=e11] [cursor=pointer]:
        - img [ref=e12]
      - generic [ref=e16]:
        - button "Undo" [ref=e17] [cursor=pointer]:
          - img [ref=e18]
        - button "Redo" [disabled] [ref=e21]:
          - img [ref=e22]
    - generic [ref=e25]:
      - button "Zoom out" [ref=e26] [cursor=pointer]: −
      - status [ref=e27]: 100%
      - button "Zoom in" [ref=e28] [cursor=pointer]: +
      - button "Reset view" [ref=e29] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    - button "Share" [ref=e31] [cursor=pointer]
```