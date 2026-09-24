# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - group "Text" [ref=e6]:
      - generic [ref=e7]: alpha beta gamma delta
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
      - button "Sticky note" [ref=e20] [cursor=pointer]:
        - generic [ref=e21]: 📝
      - generic [ref=e22]:
        - button "Undo" [ref=e23] [cursor=pointer]:
          - generic [ref=e24]: ↶
        - button "Redo" [disabled] [ref=e25]:
          - generic [ref=e26]: ↷
    - generic [ref=e27]:
      - button "Zoom out" [ref=e28] [cursor=pointer]: −
      - status [ref=e29]: 100%
      - button "Zoom in" [ref=e30] [cursor=pointer]: +
      - button "Reset view" [ref=e31] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e34] [cursor=pointer]
```