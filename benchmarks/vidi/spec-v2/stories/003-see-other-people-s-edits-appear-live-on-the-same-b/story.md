# See other people's edits appear live on the same board

| Field | Value |
|-------|-------|
| ID | 3 |
| Status | proposed |
| Priority | 3 |
| Epic | realtime-collab |
| Created | 2026-09-17T08:07:22.180Z |
| Updated | 2026-09-17T08:07:22.180Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| live.propagate | Changes reach everyone quickly | sync.room |
| live.join_state | Late joiners see the current board | sync.room |
| live.concurrent_text | Simultaneous typing is merged | sync.room |
| live.converge | Simultaneous changes settle to one result | sync.room |
| live.delete_during_edit | Deleting while someone else edits | sync.client |
| live.capacity | Capacity: up to 5 simultaneous editors | sync.room |
| live.over_capacity | More than 5 people are not blocked | sync.worker_entry |
| live.status | Connection status is visible | sync.client |
| live.catch_up | Offline edits catch up while the page stays open | sync.room |
| live.isolation | Boards stay separate | sync.worker_entry |
| live.local_selection | Selections stay personal | sync.client |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| sync.worker_entry | #2 (proposed) | #1 unit (proposed), #5 integration (proposed) | unit, integration | unit, integration |
| sync.room | #3 (proposed) | #1 unit (proposed), #6 integration (proposed) | unit, integration | unit, integration |
| sync.client | #4 (proposed) | #7 ui-component (proposed), #8 e2e (proposed), #9 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.

