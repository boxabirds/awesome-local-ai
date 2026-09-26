# Page snapshot

```yaml
- generic:
  - generic:
    - group "Sticky note" [ref=e2]:
      - textbox [active] [ref=e4]
    - generic:
      - button "Resize top-left" [ref=e5]
      - button "Resize top" [ref=e6]
      - button "Resize top-right" [ref=e7]
      - button "Resize right" [ref=e8]
      - button "Resize bottom-right" [ref=e9]
      - button "Resize bottom" [ref=e10]
      - button "Resize bottom-left" [ref=e11]
      - button "Resize left" [ref=e12]
    - generic [ref=e13]:
      - button "Select (V)" [pressed] [ref=e14] [cursor=pointer]:
        - img [ref=e15]
      - button "Text (T)" [ref=e17] [cursor=pointer]:
        - img [ref=e18]
      - button "Sticky note" [ref=e20] [cursor=pointer]:
        - img [ref=e21]
      - generic [ref=e25]:
        - button "Undo" [ref=e26] [cursor=pointer]:
          - img [ref=e27]
        - button "Redo" [disabled] [ref=e30]:
          - img [ref=e31]
    - generic [ref=e34]:
      - button "Zoom out" [ref=e35] [cursor=pointer]: −
      - status [ref=e36]: 100%
      - button "Zoom in" [ref=e37] [cursor=pointer]: +
      - button "Reset view" [ref=e38] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    - button "Share" [ref=e40] [cursor=pointer]
```