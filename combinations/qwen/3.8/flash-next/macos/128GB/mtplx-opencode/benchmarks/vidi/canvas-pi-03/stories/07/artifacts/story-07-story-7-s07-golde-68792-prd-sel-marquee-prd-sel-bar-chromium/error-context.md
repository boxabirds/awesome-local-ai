# Page snapshot

```yaml
- generic [ref=e3]:
  - button "Share" [ref=e4] [cursor=pointer]
  - generic [ref=e5]:
    - generic:
      - group "Sticky note" [ref=e6]:
        - generic [ref=e7]: A
      - group "Sticky note" [ref=e8]:
        - generic [ref=e9]: B
      - group "Sticky note" [ref=e10]:
        - generic [ref=e11]: C
  - toolbar "Tools" [ref=e12]:
    - button "Sticky note" [ref=e13] [cursor=pointer]: ▢
  - generic:
    - button "Resize north-west corner" [ref=e14]
    - button "Resize north edge" [ref=e15]
    - button "Resize north-east corner" [ref=e16]
    - button "Resize east edge" [ref=e17]
    - button "Resize south-east corner" [ref=e18]
    - button "Resize south edge" [ref=e19]
    - button "Resize south-west corner" [ref=e20]
    - button "Resize west edge" [ref=e21]
  - group "2 selected" [ref=e22]:
    - generic [ref=e23]: "2"
    - button "Delete 2 selected" [ref=e24] [cursor=pointer]:
      - img [ref=e25]
    - generic [ref=e27]: drag a handle
  - generic [ref=e28]:
    - button "Zoom out" [ref=e29] [cursor=pointer]: −
    - status "Zoom level" [ref=e30]: 64%
    - button "Zoom in" [ref=e31] [cursor=pointer]: +
    - button "Reset view" [ref=e32] [cursor=pointer]
```