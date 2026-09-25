# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - group "Text" [ref=e6]:
      - generic [ref=e7]: Went well
      - toolbar "Text actions" [ref=e9]:
        - button "S size" [ref=e10]: S
        - button "M size" [pressed] [ref=e11]: M
        - button "L size" [ref=e12]: L
        - button "XL size" [ref=e13]: XL
        - button "Delete text" [ref=e14]: 🗑
    - toolbar "Board tools" [ref=e15]:
      - button "Select (V)" [pressed] [ref=e16] [cursor=pointer]:
        - generic [ref=e17]: 🖱️
      - button "Text (T)" [ref=e18] [cursor=pointer]:
        - generic [ref=e19]: T
      - button "Shape (S)" [ref=e21] [cursor=pointer]:
        - generic [ref=e22]: ▦
      - button "Connector (L)" [ref=e23] [cursor=pointer]:
        - generic [ref=e24]: →
      - button "Pen (P)" [ref=e26] [cursor=pointer]:
        - generic [ref=e27]: ✎
      - button "Sticky note" [ref=e28] [cursor=pointer]:
        - generic [ref=e29]: 📝
      - generic [ref=e30]:
        - button "Undo" [ref=e31] [cursor=pointer]:
          - generic [ref=e32]: ↶
        - button "Redo" [disabled] [ref=e33]:
          - generic [ref=e34]: ↷
    - generic [ref=e35]:
      - button "Zoom out" [ref=e36] [cursor=pointer]: −
      - status [ref=e37]: 100%
      - button "Zoom in" [ref=e38] [cursor=pointer]: +
      - button "Reset view" [ref=e39] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e42] [cursor=pointer]
```