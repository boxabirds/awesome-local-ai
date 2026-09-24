# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - group "Sticky note" [ref=e6]:
      - textbox "Sticky note text" [active] [ref=e8]: p0
    - toolbar "Board tools" [ref=e9]:
      - button "Select (V)" [pressed] [ref=e10] [cursor=pointer]:
        - generic [ref=e11]: 🖱️
      - button "Text (T)" [ref=e12] [cursor=pointer]:
        - generic [ref=e13]: T
      - button "Sticky note" [ref=e14] [cursor=pointer]:
        - generic [ref=e15]: 📝
      - generic [ref=e16]:
        - button "Undo" [ref=e17] [cursor=pointer]:
          - generic [ref=e18]: ↶
        - button "Redo" [disabled] [ref=e19]:
          - generic [ref=e20]: ↷
    - generic [ref=e21]:
      - button "Zoom out" [ref=e22] [cursor=pointer]: −
      - status [ref=e23]: 64%
      - button "Zoom in" [ref=e24] [cursor=pointer]: +
      - button "Reset view" [ref=e25] [cursor=pointer]
  - button "Share" [ref=e28] [cursor=pointer]
```