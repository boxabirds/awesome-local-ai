# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic:
      - generic:
        - img
      - group "Sticky note" [ref=e5]:
        - generic [ref=e6]: red green blue
      - img
  - toolbar "Tools" [ref=e7]:
    - button "Select (V)" [pressed] [ref=e8] [cursor=pointer]:
      - img [ref=e9]
    - button "Sticky note" [ref=e11] [cursor=pointer]:
      - img [ref=e12]
    - button "Text (T)" [ref=e15] [cursor=pointer]:
      - img [ref=e16]:
        - generic [ref=e17]: T
    - 'button "Shape: rect (S)" [ref=e19] [cursor=pointer]':
      - img [ref=e20]
    - button "Pen (P)" [ref=e22] [cursor=pointer]:
      - img [ref=e23]
    - button "Connector (L)" [ref=e26] [cursor=pointer]:
      - img [ref=e27]
    - button "Undo" [ref=e30] [cursor=pointer]:
      - img [ref=e31]
    - button "Redo" [disabled] [ref=e34] [cursor=pointer]:
      - img [ref=e35]
  - generic [ref=e38]:
    - button "Zoom out" [ref=e39] [cursor=pointer]: −
    - status [ref=e40]: 100%
    - button "Zoom in" [ref=e41] [cursor=pointer]: +
    - button "Reset view" [ref=e42] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e43] [cursor=pointer]
```