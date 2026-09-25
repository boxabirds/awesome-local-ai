# Page snapshot

```yaml
- generic [ref=e2]:
  - generic "Board" [ref=e3]:
    - generic:
      - group "Went well" [active] [ref=e4]:
        - generic [ref=e5]: Went well
      - generic [ref=e6]: 1 selected
      - toolbar "Text" [ref=e7]:
        - button "Size S" [ref=e8] [cursor=pointer]: S
        - button "Size M" [pressed] [ref=e9] [cursor=pointer]: M
        - button "Size L" [ref=e10] [cursor=pointer]: L
        - button "Size XL" [ref=e11] [cursor=pointer]: XL
        - button "Delete text" [ref=e13] [cursor=pointer]:
          - img [ref=e14]
    - generic:
      - button "Resize right" [ref=e16]
      - button "Resize left" [ref=e17]
    - toolbar "Tools" [ref=e18]:
      - button "Select (V)" [pressed] [ref=e19] [cursor=pointer]:
        - img [ref=e20]
      - button "Text (T)" [ref=e22] [cursor=pointer]:
        - img [ref=e23]
      - button "Sticky note" [ref=e25] [cursor=pointer]:
        - img [ref=e26]
      - button "Undo" [ref=e30] [cursor=pointer]:
        - img [ref=e31]
      - button "Redo" [disabled] [ref=e33]:
        - img [ref=e34]
    - group "Zoom" [ref=e36]:
      - button "Zoom out" [ref=e37] [cursor=pointer]: −
      - status [ref=e38]: 100%
      - button "Zoom in" [ref=e39] [cursor=pointer]: +
      - button "Reset view" [ref=e40] [cursor=pointer]
    - generic: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e42] [cursor=pointer]
```