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
      - button "Shape (S)" [ref=e15] [cursor=pointer]:
        - generic [ref=e16]: ▦
      - button "Connector (L)" [ref=e17] [cursor=pointer]:
        - generic [ref=e18]: →
      - button "Sticky note" [ref=e19] [cursor=pointer]:
        - generic [ref=e20]: 📝
      - generic [ref=e21]:
        - button "Undo" [ref=e22] [cursor=pointer]:
          - generic [ref=e23]: ↶
        - button "Redo" [disabled] [ref=e24]:
          - generic [ref=e25]: ↷
    - generic [ref=e26]:
      - button "Zoom out" [ref=e27] [cursor=pointer]: −
      - status [ref=e28]: 64%
      - button "Zoom in" [ref=e29] [cursor=pointer]: +
      - button "Reset view" [ref=e30] [cursor=pointer]
  - button "Share" [ref=e33] [cursor=pointer]
```