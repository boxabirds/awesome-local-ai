# Drop images onto the board

| Field | Value |
|-------|-------|
| ID | 12 |
| Status | proposed |
| Priority | 12 |
| Epic | canvas |
| Created | 2026-09-17T08:07:37.626Z |
| Updated | 2026-09-17T08:07:37.626Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| image.drop | Drop image files | image.insert |
| image.paste | Paste an image | image.insert |
| image.pick | Pick files with the Image tool | image.insert |
| image.placement_size | Sensible placement size | image.model |
| image.types | Only supported image types | assets.api |
| image.size_limit | Size limit | assets.api |
| image.count_limit | Count limit per action | image.insert |
| image.uploading | Placeholder and progress while uploading | image.insert |
| image.shared | Uploaded images appear for everyone | image.object |
| image.upload_failure | Failed uploads can be retried or removed | image.object |
| image.unfinished | Abandoned uploads are marked | image.object |
| image.aspect_resize | Proportional resizing | image.object |
| image.unavailable | Unloadable images show a placeholder | image.object |
| image.offline | Adding images requires a connection | image.insert |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| assets.api | #3 (proposed) | #1 unit (proposed), #4 integration (proposed), #9 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| image.model | #5 (proposed) | #2 unit (proposed) | unit | unit |
| image.insert | #6 (proposed) | #1 unit (proposed), #8 ui-component (proposed), #9 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| image.object | #7 (proposed) | #8 ui-component (proposed), #9 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.

