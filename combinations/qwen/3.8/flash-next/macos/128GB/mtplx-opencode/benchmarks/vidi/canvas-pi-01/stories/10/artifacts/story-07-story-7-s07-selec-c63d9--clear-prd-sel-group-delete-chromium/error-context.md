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
      - button "Shape (S)" [ref=e20] [cursor=pointer]:
        - generic [ref=e21]: ▦
      - button "Connector (L)" [ref=e22] [cursor=pointer]:
        - generic [ref=e23]: →
      - button "Sticky note" [ref=e24] [cursor=pointer]:
        - generic [ref=e25]: 📝
      - generic [ref=e26]:
        - button "Undo" [ref=e27] [cursor=pointer]:
          - generic [ref=e28]: ↶
        - button "Redo" [disabled] [ref=e29]:
          - generic [ref=e30]: ↷
    - generic [ref=e31]:
      - button "Zoom out" [ref=e32] [cursor=pointer]: −
      - status [ref=e33]: 100%
      - button "Zoom in" [ref=e34] [cursor=pointer]: +
      - button "Reset view" [ref=e35] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e38] [cursor=pointer]
```