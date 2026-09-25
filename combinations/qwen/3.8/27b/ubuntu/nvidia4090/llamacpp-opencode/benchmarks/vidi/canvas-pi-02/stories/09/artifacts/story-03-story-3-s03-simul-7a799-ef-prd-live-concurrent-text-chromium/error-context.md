# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic:
      - generic:
        - img
      - group "Sticky note" [ref=e5]:
        - generic [ref=e6]: red green blue
  - toolbar "Tools" [ref=e7]:
    - button "Select (V)" [pressed] [ref=e8] [cursor=pointer]:
      - img [ref=e9]
    - button "Sticky note" [ref=e11] [cursor=pointer]:
      - img [ref=e12]
    - button "Text (T)" [ref=e15] [cursor=pointer]:
      - img [ref=e16]:
        - generic [ref=e17]: T
    - button "Undo" [ref=e18] [cursor=pointer]:
      - img [ref=e19]
    - button "Redo" [disabled] [ref=e22] [cursor=pointer]:
      - img [ref=e23]
  - generic [ref=e26]:
    - button "Zoom out" [ref=e27] [cursor=pointer]: −
    - status [ref=e28]: 100%
    - button "Zoom in" [ref=e29] [cursor=pointer]: +
    - button "Reset view" [ref=e30] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e31] [cursor=pointer]
```