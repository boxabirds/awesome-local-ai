# Page snapshot

```yaml
- generic [ref=e2]:
  - button "Sticky note" [ref=e4] [cursor=pointer]:
    - generic [ref=e5]: 📌
  - group "Sticky note" [ref=e7]:
    - textbox [active] [ref=e9]: typed
  - generic:
    - button "Resize top-left" [ref=e10]
    - button "Resize top" [ref=e11]
    - button "Resize top-right" [ref=e12]
    - button "Resize right" [ref=e13]
    - button "Resize bottom-right" [ref=e14]
    - button "Resize bottom" [ref=e15]
    - button "Resize bottom-left" [ref=e16]
    - button "Resize left" [ref=e17]
  - group "Zoom controls" [ref=e18]:
    - button "Zoom out" [ref=e19] [cursor=pointer]: −
    - status [ref=e20]: 100%
    - button "Zoom in" [ref=e21] [cursor=pointer]: +
    - button "Reset view" [ref=e22] [cursor=pointer]
  - status: Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
  - button "Share" [ref=e24] [cursor=pointer]
```