# Product Requirements Document — BOSS AI

| Field | Value |
|---|---|
| Product | BOSS AI — Dynamic Autonomous AI Organization & Product Factory Platform |
| Document Version | 1.0.0 |
| Status | `Approved` (working blueprint) |
| Date | 2026-11-22 |
| Owner | [OWNER INPUT REQUIRED] |

---

## 1. Product Vision

A single platform that first amplifies one person's productivity on one phone, then grows into an autonomous AI organization that plans, builds, audits, and ships products — governed by a non-negotiable constitution, a default-deny policy engine, and an evidence-led, revenue-first growth philosophy.

## 2. Problem Statement

- Solo builders working from a single Android device suffer **context fragmentation**: specs, prompts, and code scattered across chats and editors.
- Browser-based development (github.dev) removes CLI friction but demands **zero-placeholder, copy-paste-ready outputs**.
- Free-tier economics mean every architectural choice must be **zero-spend first**, with hard guards against surprise costs.
- Future SaaS ambitions are usually killed by early schema debt; BOSS AI mandates **tenant-ready data models from day one**.

## 3. Target Personas

### 3.1 Solo Builder
- One operator, one Android smartphone, mobile browser workflow.
- Needs: task clarity (Daily Focus), project tracking with honest progress, quick notes, reliable backup, offline access.
- Success feeling: "Everything I need is on my phone, offline, and nothing is lost."

### 3.2 AI Orchestrator
- The same operator acting as manager of multiple AI agents (architect, builder, auditor, ops).
- Needs: prompt packs, governance gates (Class A/B/C), audit trails, policy enforcement, provider independence.
- Success feeling: "Agents execute safely; I approve only what truly needs my signature."

## 4. Goals & Non-Goals

**Goals (Phase 0–1.5):** full governance documentation suite; working Personal Productivity Hub v1.0 (Tasks/Projects/Notes/Search/Backup) on mobile browsers; QA-01→QA-12 static gate; GitHub Pages free hosting.

**Goals (Phase 2–3):** autonomous agent core (registry, state machine, policy, tool broker, scoped memory, AI adapters) as modular ES6 framework code.

**Non-Goals (now):** multi-tenant SaaS deployment, server backends, paid APIs, native apps, CLI/Docker toolchains, team collaboration features.

## 5. Functional Requirements

### Phase 0 — Governance & Foundations
- **FR-0.1** Repository documentation suite: README, PRD, ADR-LOG, RISK-REGISTER, CHANGELOG, PROVIDER-REGISTER.
- **FR-0.2** Autonomy governance matrix (Class A/B/C) binding on all agent output.
- **FR-0.3** Status vocabulary enforcement (`Proposed`…`Verified`) and honesty rules for evidence.

### Phase 1 — Personal Productivity Hub v1.0
- **FR-1.1 (Storage)** `StorageAdapter` over IndexedDB with LocalStorage fallback: atomic writes, `schemaVersion: 1`, `crypto.randomUUID()` ids, ISO 8601 `createdAt`/`updatedAt`, mandatory `ownerId`/`tenantId`, `QuotaExceededError` handling with user alerts.
- **FR-1.2 (Tasks)** Task CRUD; priorities `Low|Medium|High|Urgent`; statuses `Inbox|Next Action|In Progress|Waiting|Completed` with validated transitions; tags; due dates; filters; `getDailyFocus()`.
- **FR-1.3 (Projects)** Project CRUD; statuses `Planning|Active|Paused|Completed|Archived`; link tasks via `projectId`; `calculateProgress(projectId)`; archived projects immutable.
- **FR-1.4 (Notes)** Note CRUD with `title`, body, `tags`, `isPinned`; cross-links to `projectId`/`taskId`.
- **FR-1.5 (Search)** Real-time cross-entity `search(query)` across Tasks/Projects/Notes, grouped by entity type with highlight metadata; result tap switches target view.
- **FR-1.6 (Backup)** `exportData()` JSON with `version`, `exportedAt`, `schemaVersion`; `importData()` strict pre-validation rejecting malformed payloads without touching active storage; `calculateStorageUsage()` with 80% warning flag; destructive actions behind confirm modals.
- **FR-1.7 (Shell)** Mobile-first shell 360px–412px, sticky header, bottom nav (Dashboard|Tasks|Projects|Notes|More), ≥44×44px touch targets, dark/light theme, storage warning banner, offline PWA shell.

### Phase 1.5 — Quality & Security Gates
- **FR-1.8** QA-01→QA-12 audit matrix covering persistence, CRUD/lifecycle, daily focus, progress math, cross-linking, search, backup export, malformed import rejection, mobile layout, XSS resilience, secret scan, offline readiness.
- **FR-1.9** `RELEASE-GATE-V1.0.md` sign-off document with explicit Class B Owner approval block.

### Phase 2 & 3 — Autonomous Agent Core
- **FR-2.1** `AgentRegistry` — agent metadata, capabilities, allowed tools, context scope.
- **FR-2.2** `TaskStateMachine` — enforced states `Pending → PolicyCheck → Executing → AwaitingOwnerApproval → Completed/Failed` with transition logging and rejection of invalid moves.
- **FR-2.3** `PolicyEvaluator` — default-deny Class A/B/C evaluation returning `{ allowed, requiresOwnerApproval, actionClass, reason }`.
- **FR-2.4** `ToolBroker` — sandboxed tool execution gated by policy clearance; append-only audit log.
- **FR-2.5** `ScopedMemory` — namespace-isolated memory with tenant tagging and authorization.
- **FR-2.6** `AIAdapter` — provider-independent `complete()`/`stream()` interface with OpenAI/Anthropic/Gemini/Ollama adapters and local usage metering.

## 6. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | Global search completes in **< 500 ms** over 500 records (client-side); UI interactions respond within 100 ms on mid-range Android |
| Offline Resilience | App shell and data fully functional without network (LocalStorage/IndexedDB + service-worker cache) |
| Mobile UX | Viewport 360px–412px primary; zero horizontal scrolling; touch targets ≥ 44×44px; fluid scaling to desktop |
| Security | Zero `innerHTML`/`outerHTML`/`document.write`; zero hardcoded secrets; default-deny policy; untrusted-input sanitization |
| Data Integrity | Atomic writes; schema versioning; import validation before mutation; destructive actions double-confirmed |
| Portability | JSON export/import round-trip lossless; tenant-ready schema (`ownerId`/`tenantId`) |
| Cost | Zero-spend stack; local usage meters with hard stops; `[VERIFY AGAINST CURRENT PROVIDER TERMS]` discipline |

## 7. Success Metrics

| Metric | Target |
|---|---|
| QA gate | 12/12 QA cases `PASS` at v1.0 |
| Backup reliability | 100% round-trip fidelity (export → wipe → import) |
| Mobile integrity | 0 horizontal-overflow findings at 360px/390px/412px |
| XSS posture | 0 unsafe DOM sinks in source scan |
| Secret posture | 0 hardcoded credentials in source scan |
| Cost | $0.00 infrastructure spend for Phase 1 |
| Workflow | Daily Focus lists ≤ 10 items for a focused workday (qualitative) |

## 8. Roadmap (Phase 0–5)

| Phase | Theme | Outcome |
|---|---|---|
| **0** | Governance & Foundations | Docs suite, ADRs, risk register, provider register |
| **1** | Personal Productivity Hub v1.0 | VS1 Core+Tasks → VS2 Projects/Notes/Search → VS3 Backup |
| **1.5** | Quality & Security Gates | QA-01→QA-12 + Release Gate sign-off |
| **2** | Autonomous Agent Core | Registry, StateMachine, PolicyEvaluator, ToolBroker, ScopedMemory, AIAdapter |
| **3** | Orchestrator Layer | Agent workflows: plan → build → audit → report |
| **4** | Product Factory | Multi-product workspaces driven by prompt packs |
| **5** | SaaS Migration | Multi-tenant rollout on existing `ownerId`/`tenantId` schema (zero rewrite) |

## 9. Risks & Dependencies

See [`RISK-REGISTER.md`](RISK-REGISTER.md) for the full catalog (storage quotas, LLM injection vectors, provider term drift, single-device data loss). Key dependency: GitHub Pages free hosting and github.dev editing remain available on the Owner's Android device.

## 10. Open Owner Inputs

| Item | Tag |
|---|---|
| Product Owner name for release approval | `[OWNER INPUT REQUIRED]` |
| Preferred LLM provider for Phase 3 runtime keys | `[OWNER INPUT REQUIRED]` |
| Final GitHub account/username for Pages URL | `[OWNER INPUT REQUIRED]` |
