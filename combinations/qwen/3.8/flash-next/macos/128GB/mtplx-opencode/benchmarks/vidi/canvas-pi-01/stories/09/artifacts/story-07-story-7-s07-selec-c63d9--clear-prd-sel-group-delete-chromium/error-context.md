# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - generic:
        - group "Sticky note" [ref=e6]:
          - generic [ref=e7]: all0
        - group "Sticky note" [ref=e8]:
          - generic [ref=e9]: all1
        - group "Sticky note" [ref=e10]:
          - generic [ref=e11]: all2
    - toolbar "Selection actions" [ref=e12]:
      - text: 3 selected
      - button "Delete selection" [ref=e13]: 🗑
    - toolbar "Board tools" [ref=e14]:
      - button "Select (V)" [pressed] [ref=e15] [cursor=pointer]:
        - generic [ref=e16]: 🖱️
      - button "Text (T)" [ref=e17] [cursor=pointer]:
        - generic [ref=e18]: T
      - button "Sticky note" [ref=e19] [cursor=pointer]:
        - generic [ref=e20]: 📝
      - generic [ref=e21]:
        - button "Undo" [ref=e22] [cursor=pointer]:
          - generic [ref=e23]: ↶
        - button "Redo" [disabled] [ref=e24]:
          - generic [ref=e25]: ↷
    - generic [ref=e26]:
      - button "Zoom out" [ref=e27] [cursor=pointer]: −
      - status [ref=e28]: 100%
      - button "Zoom in" [ref=e29] [cursor=pointer]: +
      - button "Reset view" [ref=e30] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e33] [cursor=pointer]
```