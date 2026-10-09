# Story 12 — Drop images onto the board

| Task | Description | Status |
|------|-------------|--------|
| 1 | Unit tests for format sniffing, file validation, image format (TC-01, TC-02, TC-08, TC-09) | done |
| 2 | Unit tests for image model (TC-03, TC-04, TC-05, TC-06, TC-07) | done |
| 3 | Worker: assets API (R2 upload/serve, magic-byte sniff, 10 MB limit, immutable GET) | done |
| 4 | Integration tests for assets API (TC-10, TC-11, TC-12, TC-13, TC-15, TC-16) | done |
| 5 | Shared image object model (snapshot fields, placeholders, ready/failed, displayStatus) | done |
| 6 | Client image insert: drop/paste/picker, validation, upload, retry, offline gate, toasts | done |
| 7 | ImageObject render + registry entry (states, resize, min size, error handling) | done |
| 8 | Component tests (TC-17, TC-18, TC-19, TC-21, TC-22, TC-23, TC-24, TC-29) | done |
| 9 | E2E tests (TC-25, TC-26, TC-27, TC-28) | done |

## Notes

- Test-first tasks 1-2: tests written before the implementation they cover.
- Fixture images are generated (PNG via zlib) or synthesized (magic-byte bytes); no external
  image files are downloaded.
- All green: typecheck clean; 214 unit, 89 component, 53 integration, 39 e2e (chromium) passing.
