# Architecture Decision Record Log — BOSS AI

| Field | Value |
|---|---|
| Document Version | 1.0.0 |
| Status | `Approved` |
| Date | 2026-11-22 |
| Format | Context → Decision → Consequences (per ADR) |

---

## ADR Template

- **ADR-NNN:** Title
- **Status:** Proposed | Approved | Superseded
- **Context:** Forces at play.
- **Decision:** The choice made.
- **Consequences:** Trade-offs accepted.

---

## ADR-001: Modular Monolith Client-Side SPA

- **Status:** `Approved`
- **Context:** BOSS AI must run on a single Android smartphone with zero CLI access, zero build toolchain, and zero-spend hosting (GitHub Pages static hosting). Microservices or server backends would introduce hosting cost, network dependence, and operational overhead the owner cannot service from a phone. At the same time, the codebase must not decay into one monolithic file: Phase 2 introduces autonomous-agent modules with strict boundaries.
- **Decision:** Adopt a **Modular Monolith** as a static client-side Single Page Application. One deployable bundle (`index.html` + `styles.css` + `app.js` + `src/*.js` ES modules) with strict internal module boundaries: UI layer (`app.js`) never touches storage directly; domain engines (`TaskEngine`, `ProjectEngine`, `NoteEngine`, `SearchEngine`, `BackupEngine`) own business logic; infrastructure (`StorageAdapter`) sits behind a provider-independent interface. Phase 2 modules follow the same boundary rules.
- **Consequences:**
  - (+) Zero build step — files are copy-pasted into github.dev and deployed instantly.
  - (+) Zero hosting cost; offline-capable by construction.
  - (+) Clear module seams make later SaaS extraction (Phase 5) mechanical.
  - (−) No server-side enforcement; all governance runs client-side (mitigated by Phase 2 `PolicyEvaluator` + `ToolBroker` design and the human Class B gate).
  - (−) Bundle discipline is manual; module boundaries are enforced by convention and code review (QA-10/QA-11 scans assist).

## ADR-002: StorageAdapter Abstraction over IndexedDB/LocalStorage

- **Status:** `Approved`
- **Context:** Client persistence must survive browser reloads, work offline, tolerate private-browsing/low-quota environments, and carry multi-tenant metadata (`ownerId`, `tenantId`) so Phase 5 SaaS migration needs no schema rewrite. Raw `localStorage` is too brittle (5 MB, synchronous, string-only); raw IndexedDB is verbose and inconsistently available in degraded environments.
- **Decision:** Build **`StorageAdapter`** — a single ES6 module exposing atomic `get/put/delete/list/clear` operations over **IndexedDB with automatic LocalStorage fallback**. The adapter enforces: `schemaVersion: 1` metadata records, `crypto.randomUUID()` entity IDs (with `crypto.getRandomValues` fallback), ISO 8601 `createdAt`/`updatedAt` stamps, mandatory `ownerId`/`tenantId` fields with defaults `local-owner`/`default-tenant`, and `QuotaExceededError` interception routed to user-facing alert callbacks. All domain engines depend on this interface only.
- **Consequences:**
  - (+) Swap persistence backends without touching engines or UI.
  - (+) Quota failures surface as UI warnings before data loss.
  - (+) Tenant-ready records: Phase 5 adds tenant scoping as a filter, not a migration.
  - (−) Fallback path (LocalStorage) is capacity-limited (~5 MB) — mitigated by `calculateStorageUsage()` 80% warnings (`BackupEngine`).
  - (−) Slight runtime overhead for stamping/validation on each write — accepted for integrity.

## ADR-003: Android-First Mobile UI Architecture

- **Status:** `Approved`
- **Context:** The primary creation, editing, and repository-management device is an Android smartphone (360px–412px viewports) using Chrome and github.dev. Desktop-first designs break the owner's actual workflow; framework UI kits (Bootstrap-heavy, desktop tables) bloat the bundle and often violate touch-target norms.
- **Decision:** **Android-First Mobile UI**: hand-written HTML5/CSS3/ES6 with a thumb-reachable bottom navigation bar (Dashboard | Tasks | Projects | Notes | More), sticky top header, bottom-sheet modals, and CSS custom properties for dark/light theming. Hard constraints: layout must show zero horizontal scrolling between 360px–412px, every interactive target ≥ 44×44px, safe-area insets respected, and fluid scaling up to desktop. DOM rendering is **createElement/textContent only** (no `innerHTML`) to make XSS structurally impossible.
- **Consequences:**
  - (+) The owner's real device is the first-class target; QA-09 audits exactly this envelope.
  - (+) Zero framework dependencies; instant cold start on mid-range Android.
  - (+) Theming and layout controlled by ~one stylesheet with CSS variables.
  - (−) No framework conveniences (virtual DOM, routing library) — `app.js` orchestrator handles view switching manually (accepted; five views only).
  - (−) Desktop experience is "fluid scaling", not a separate theme — acceptable for v1.0 scope.

---

## Decision Index

| ADR | Title | Status |
|---|---|---|
| ADR-001 | Modular Monolith Client-Side SPA | `Approved` |
| ADR-002 | StorageAdapter Abstraction over IndexedDB/LocalStorage | `Approved` |
| ADR-003 | Android-First Mobile UI Architecture | `Approved` |
