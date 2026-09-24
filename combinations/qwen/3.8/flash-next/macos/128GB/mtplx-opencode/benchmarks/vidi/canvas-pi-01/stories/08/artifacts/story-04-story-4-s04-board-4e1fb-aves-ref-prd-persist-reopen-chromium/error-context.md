# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - group "Sticky note" [ref=e6]:
      - textbox "Sticky note text" [active] [ref=e8]: p0
    - toolbar "Board tools" [ref=e9]:
      - button "Sticky note" [ref=e10] [cursor=pointer]:
        - generic [ref=e11]: 📝
      - generic [ref=e12]:
        - button "Undo" [ref=e13] [cursor=pointer]:
          - generic [ref=e14]: ↶
        - button "Redo" [disabled] [ref=e15]:
          - generic [ref=e16]: ↷
    - generic [ref=e17]:
      - button "Zoom out" [ref=e18] [cursor=pointer]: −
      - status [ref=e19]: 64%
      - button "Zoom in" [ref=e20] [cursor=pointer]: +
      - button "Reset view" [ref=e21] [cursor=pointer]
  - button "Share" [ref=e24] [cursor=pointer]
```