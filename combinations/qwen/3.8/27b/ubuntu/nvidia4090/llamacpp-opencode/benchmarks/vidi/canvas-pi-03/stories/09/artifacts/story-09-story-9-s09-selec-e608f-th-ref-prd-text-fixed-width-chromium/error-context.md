# Page snapshot

```yaml
- generic [active]:
  - generic:
    - 'group "Text: lpha beta gamma delta" [ref=e2]':
      - generic [ref=e3]: lpha beta gamma delta
    - generic:
      - button "Resize right" [ref=e4]
      - button "Resize left" [ref=e5]
    - toolbar "Text actions" [ref=e7]:
      - button "Text size S" [ref=e8] [cursor=pointer]: S
      - button "Text size M" [pressed] [ref=e9] [cursor=pointer]: M
      - button "Text size L" [ref=e10] [cursor=pointer]: L
      - button "Text size XL" [ref=e11] [cursor=pointer]: XL
      - button "Delete text" [ref=e12] [cursor=pointer]: Delete
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