# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - button "Share" [ref=e6] [cursor=pointer]
  - generic [ref=e7]:
    - generic [ref=e8]:
      - group "Sticky note" [ref=e9]:
        - generic [ref=e10]: green blue
      - generic:
        - img
    - generic [ref=e11]:
      - generic [ref=e13]:
        - img "Curious Otter, you" [ref=e14]: C
        - img "Curious Otter 2" [ref=e15]: C
      - generic [ref=e16]:
        - generic [ref=e17]: Curious Otter
        - button "Rename" [ref=e18]
    - generic [ref=e19]:
      - button "Select (V)" [pressed] [ref=e20] [cursor=pointer]:
        - img [ref=e21]
      - button "Text (T)" [ref=e23] [cursor=pointer]:
        - img [ref=e24]:
          - generic [ref=e25]: T
      - button "Sticky note" [ref=e26] [cursor=pointer]:
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
  - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
```