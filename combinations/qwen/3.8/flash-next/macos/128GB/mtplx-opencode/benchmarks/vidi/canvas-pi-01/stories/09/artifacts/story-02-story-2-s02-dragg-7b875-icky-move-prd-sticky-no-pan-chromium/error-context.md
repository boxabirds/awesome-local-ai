# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - generic:
        - group "Sticky note" [ref=e6]:
          - generic [ref=e7]: still
        - group "Sticky note" [active] [ref=e8]:
          - generic [ref=e9]: mover
          - toolbar "Note actions" [ref=e11]:
            - button "Yellow colour" [pressed] [ref=e12] [cursor=pointer]
            - button "Orange colour" [ref=e13] [cursor=pointer]
            - button "Green colour" [ref=e14] [cursor=pointer]
            - button "Blue colour" [ref=e15] [cursor=pointer]
            - button "Pink colour" [ref=e16] [cursor=pointer]
            - button "Violet colour" [ref=e17] [cursor=pointer]
            - button "Delete note" [ref=e18] [cursor=pointer]: 🗑
    - toolbar "Board tools" [ref=e19]:
      - button "Select (V)" [pressed] [ref=e20] [cursor=pointer]:
        - generic [ref=e21]: 🖱️
      - button "Text (T)" [ref=e22] [cursor=pointer]:
        - generic [ref=e23]: T
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