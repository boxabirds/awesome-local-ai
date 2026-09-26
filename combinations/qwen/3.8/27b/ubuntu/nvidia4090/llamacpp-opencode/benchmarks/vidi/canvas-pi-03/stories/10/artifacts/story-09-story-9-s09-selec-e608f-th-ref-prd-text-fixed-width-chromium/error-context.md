# Page snapshot

```yaml
- generic [active]:
  - generic:
    - 'group "Text: lpha beta gamma delta" [ref=e2]':
      - generic [ref=e3]: lpha beta gamma delta
    - generic:
      - button "Resize right" [ref=e5]
      - button "Resize left" [ref=e6]
    - toolbar "Text actions" [ref=e8]:
      - button "Text size S" [ref=e9] [cursor=pointer]: S
      - button "Text size M" [pressed] [ref=e10] [cursor=pointer]: M
      - button "Text size L" [ref=e11] [cursor=pointer]: L
      - button "Text size XL" [ref=e12] [cursor=pointer]: XL
      - button "Delete text" [ref=e13] [cursor=pointer]: Delete
    - generic [ref=e14]:
      - button "Select (V)" [ref=e15] [cursor=pointer]:
        - img [ref=e16]
      - button "Text (T)" [ref=e18] [cursor=pointer]:
        - img [ref=e19]
      - button "Shape (S)" [ref=e21] [cursor=pointer]:
        - img [ref=e22]
      - button "Connector (L)" [pressed] [ref=e25] [cursor=pointer]:
        - img [ref=e26]
      - button "Sticky note" [ref=e29] [cursor=pointer]:
        - img [ref=e30]
      - generic [ref=e34]:
        - button "Undo" [ref=e35] [cursor=pointer]:
          - img [ref=e36]
        - button "Redo" [disabled] [ref=e39]:
          - img [ref=e40]
    - generic [ref=e43]:
      - button "Zoom out" [ref=e44] [cursor=pointer]: −
      - status [ref=e45]: 100%
      - button "Zoom in" [ref=e46] [cursor=pointer]: +
      - button "Reset view" [ref=e47] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    - button "Share" [ref=e49] [cursor=pointer]
```