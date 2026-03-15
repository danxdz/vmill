# Factory + Router/Drawings Strict Backlog

Owner: VMill core team  
Date: 2026-03-14  
Goal: finish reliability first, then compliance workflows.

## Execution Order (do not reorder)

1. Save Reliability + Conflict UX (P0)
2. Router/Drawings Performance + Stability (P0)
3. Product-level Characteristics Flow Cleanup (P1)
4. AS9102 Traceability Baseline (P1)
5. CAPA/MRB Workflow (P2)
6. Security Controls Baseline (CMMC/DFARS-ready) (P2)

## 1) Save Reliability + Conflict UX (P0)

### Scope
- Global save state visible on all modules.
- Explicit user alert on unsaved/offline/auth/conflict.
- Manual retry button.

### Deliverables
- Sync status chip in shell (`Saved`, `Saving`, `Conflict`, `Offline`, `Login expired`).
- Retry action that forces push.
- Structured sync status payload available from data layer.

### Definition of Done
- User always knows if changes are saved.
- On 409 conflict, UI shows retry/backoff state and does not silently fail.
- On auth expiration, UI clearly shows not saved until re-login.

## 2) Router/Drawings Performance + Stability (P0)

### Scope
- Remove heavy redraw loops and duplicate listeners.
- Make module switch fast (Drawings <-> Router).
- Keep image/box/bubble positions consistent under zoom/pan.

### Deliverables
- Debounced render pipeline for annotation lists and canvas overlays.
- Cache: thumbnails and transformed preview assets.
- Profiling script for medium/large docs.

### Definition of Done
- No UI freeze > 300ms for normal interactions on medium demo.
- Switching modules completes in < 1.2s on local machine.
- Annotation overlay alignment stays correct after zoom, pan, reload.

## 3) Product-level Characteristics Flow Cleanup (P1)

### Scope
- One clear selection model: master characteristics linked to many operations.
- Remove duplicate forms and fallback UI branches.

### Deliverables
- Single inline table/list for master characteristics.
- Multi-operation assignment (many-to-many) with auto-save and visible count.
- Clear labels: "Drawing Characteristic" and "Operation Assignment".

### Definition of Done
- No triple-form confusion.
- Select/deselect works reliably and persists after reload.
- Selected count always matches server/local state.

## 4) AS9102 Traceability Baseline (P1)

### Scope
- First Article Inspection package-ready data lineage.

### Deliverables
- Immutable record IDs for drawing characteristic -> operation -> inspection result.
- Revision lock per drawing/document.
- Export bundle seed: part metadata + characteristic list + revision references.

### Definition of Done
- Every measured characteristic has source doc, revision, and operation chain.
- Exported package can be audited back to origin data.

## 5) CAPA/MRB Workflow (P2)

### Scope
- Non-conformance handling with closure trace.

### Deliverables
- NCR model (issue, severity, owner, due date).
- CAPA lifecycle states + approval trail.
- MRB disposition options and evidence attachments.

### Definition of Done
- Closed issue cannot be edited without reopening/audit event.
- Full timeline of decisions and approvals is exportable.

## 6) Security Controls Baseline (P2)

### Scope
- Foundation for CMMC/DFARS-aligned behavior.

### Deliverables
- Role-based access matrix hardened per module/action.
- Session timeout + re-auth for critical actions.
- Security/compliance help entry (login + app header) with plain-language summary.
- Audit events for login, data export, critical edits.

### Definition of Done
- Users can see why an action is denied.
- Critical actions require valid session and produce audit entries.
- Security summary is accessible from login and in-app.

## Suggested Sprint Split

- Sprint A (now): Items 1 + 2
- Sprint B: Item 3 + start 4
- Sprint C: finish 4 + 5
- Sprint D: 6 + hardening + release checklist
