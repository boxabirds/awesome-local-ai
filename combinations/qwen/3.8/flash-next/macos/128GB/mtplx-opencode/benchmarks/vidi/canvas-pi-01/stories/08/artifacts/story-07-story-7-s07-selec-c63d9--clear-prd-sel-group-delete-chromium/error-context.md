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
      - button "Sticky note" [ref=e15] [cursor=pointer]:
        - generic [ref=e16]: 📝
      - generic [ref=e17]:
        - button "Undo" [ref=e18] [cursor=pointer]:
          - generic [ref=e19]: ↶
        - button "Redo" [disabled] [ref=e20]:
          - generic [ref=e21]: ↷
    - generic [ref=e22]:
      - button "Zoom out" [ref=e23] [cursor=pointer]: −
      - status [ref=e24]: 100%
      - button "Zoom in" [ref=e25] [cursor=pointer]: +
      - button "Reset view" [ref=e26] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e29] [cursor=pointer]
```