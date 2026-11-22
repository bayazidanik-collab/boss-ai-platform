# BOSS AI — Dynamic Autonomous AI Organization & Product Factory Platform

> **Personal-First · Offline-First · Mobile-First · Zero-Spend**

| Field | Value |
|---|---|
| Document Status | `Implemented` |
| Release Status | Awaiting Class B Owner Sign-off (`RELEASE-GATE-V1.0.md`) |
| Version | 1.0.0 |
| Date | 2026-11-22 |
| License | MIT |
| Primary Hardware | Android smartphone (mobile browser, github.dev editor) |

---

## 1. Mission Statement

BOSS AI is a **Dynamic Autonomous AI Organization & Product Factory Platform**. It is engineered as a **personal-first, offline-first, single-user application today**, wrapped in a multi-tenant-ready data model so that future SaaS migration requires **zero database schema rewrites**.

Phase 1 ships the **Personal Productivity Hub v1.0** — a dependency-free, mobile-first single-page application (Tasks, Projects, Notes, Global Search, Backup). Phase 2+ establishes the **Autonomous Agent Core** (Agent Registry, Task State Machine, Default-Deny Policy Evaluator, Tool Broker, Scoped Memory, Provider-Independent AI Adapters).

## 2. Core Principles (Constitution Summary)

1. **Modular Monolith First** — one deployable client bundle with strict internal module boundaries.
2. **Adapter Pattern** — Storage, LLM Providers, Event Bus, and Network Messaging sit behind provider-independent interfaces.
3. **Separation of Concerns** — zero direct database calls from UI; the UI layer talks only to engines and adapters.
4. **Multi-Tenant Readiness** — every persisted record carries mandatory `ownerId` (default `local-owner`) and `tenantId` (default `default-tenant`).
5. **Zero-Spend Imperative** — free tiers only (GitHub Pages, LocalStorage/IndexedDB, free-tier LLM APIs), with local usage tracking and hard-stop quota monitors.
6. **Mobile-First** — responsive, touch-optimized UI for 360px–412px viewports (fluid to desktop); touch targets ≥ 44×44px; **zero CLI / Docker / Node.js assumptions**.
7. **Security Baseline** — Default-Deny policy engine; all external input is untrusted; **absolute prohibition of `innerHTML`, `outerHTML`, `document.write`**; zero hardcoded secrets.
8. **Honesty Rule** — status vocabulary is exactly: `Proposed`, `Approved`, `Implemented`, `Tested`, `Released`, `Verified`. No completion claims without real execution evidence.

## 3. Feature Set

### Phase 1 — Personal Productivity Hub v1.0

| Module | Capability |
|---|---|
| Dashboard | Daily Focus view, live counters, quick capture |
| Task Engine | Full CRUD, priorities (`Low/Medium/High/Urgent`), workflow statuses (`Inbox → Next Action → In Progress → Waiting → Completed`), tags, due dates, status-transition validation |
| Project Engine | Project CRUD, statuses (`Planning/Active/Paused/Completed/Archived`), task linking via `projectId`, automatic completion percentage, archive immutability |
| Note Engine | Notes with title, body, tags, `isPinned`, cross-links to `projectId` / `taskId` |
| Global Search | Real-time cross-entity search (Tasks + Projects + Notes) with grouped results, match-highlight metadata, and target-view switching |
| Backup Engine | Validated JSON export/import (`version`, `exportedAt`, `schemaVersion` headers), malformed-payload rejection without storage mutation, storage usage meter with 80% warning |
| App Shell | Sticky header, bottom navigation (Dashboard \| Tasks \| Projects \| Notes \| More), dark/light theme, offline PWA service-worker shell, storage warning banner |

### Phase 2 — Autonomous Agent Core (framework modules)

| Module | Capability |
|---|---|
| `AgentRegistry.js` | Registration of operational agents (System Architect, Code Builder, Security Auditor, Operations Manager) with capabilities, allowed tools, context scope |
| `TaskStateMachine.js` | Strict execution states: `Pending → PolicyCheck → Executing → AwaitingOwnerApproval → Completed / Failed`; invalid transitions rejected and logged |
| `PolicyEvaluator.js` | Default-Deny evaluator over Class A / B / C action rules |
| `ToolBroker.js` | Sandboxed tool execution broker; every payload cleared by `PolicyEvaluator` first; append-only audit log |
| `ScopedMemory.js` | Namespace-isolated key-value memory with `ownerId`/`tenantId` tagging and authorization checks |
| `AIAdapter.js` | Provider-independent LLM bridge (`complete`, `stream`) with OpenAI / Anthropic / Gemini / Ollama adapters and local usage metering |

## 4. Architecture Blueprint

```
+-------------------------------------------------------+
|                    UI LAYER (index.html)               |
|   Dashboard | Tasks | Projects | Notes | More/Search   |
|        (safe DOM only — createElement/textContent)     |
+--------------------------+----------------------------+
                           |  events / state
                           v
+-------------------------------------------------------+
|                 ORCHESTRATOR (app.js)                  |
+--------------------------+----------------------------+
                           |
        +------------------+-------------------+
        |                  |                   |
        v                  v                   v
+---------------+  +---------------+  +----------------+
| TaskEngine    |  | ProjectEngine |  | NoteEngine     |
+---------------+  +---------------+  +----------------+
        |                  |                   |
        +------------------+-------------------+
                           |
                           v
+-------------------------------------------------------+
|   SearchEngine        BackupEngine                    |
+--------------------------+----------------------------+
                           |
                           v
+-------------------------------------------------------+
|        StorageAdapter (IndexedDB / LocalStorage)       |
|   schemaVersion · crypto.randomUUID · ISO 8601 times   |
|   ownerId + tenantId on every record · quota guard     |
+-------------------------------------------------------+

Phase 2 (framework): AgentRegistry → TaskStateMachine → PolicyEvaluator
                     → ToolBroker → ScopedMemory → AIAdapter (OpenAI/Anthropic/Gemini/Ollama)
```

## 5. Repository Layout (GitHub Pages root-deploy ready)

```
boss-ai-platform/
├── README.md                  # This document
├── PRD.md                     # Product Requirements Document
├── ADR-LOG.md                 # Architecture Decision Records
├── RISK-REGISTER.md           # Risk catalog & mitigations
├── CHANGELOG.md               # Keep a Changelog
├── PROVIDER-REGISTER.md       # Free-tier provider & quota register
├── QA-MATRIX-REPORT.md        # QA-01 → QA-12 static audit matrix
├── RELEASE-GATE-V1.0.md       # Release sign-off gate (Class B)
├── index.html                 # App shell (root — required for Pages root deploy)
├── styles.css                 # Mobile-first theme system
├── app.js                     # UI orchestrator
├── manifest.webmanifest       # PWA manifest
├── sw.js                      # Offline service worker (cache shell)
├── icons/
│   └── icon.svg               # Application icon (SVG, zero binary assets)
└── src/
    ├── StorageAdapter.js      # WP2 — universal client storage
    ├── TaskEngine.js          # WP2 — task lifecycle domain
    ├── ProjectEngine.js       # WP3 — projects & progress metrics
    ├── NoteEngine.js          # WP3 — notes & cross-linking
    ├── SearchEngine.js        # WP3 — cross-entity real-time search
    ├── BackupEngine.js        # WP4 — export / import / quota meter
    ├── AgentRegistry.js       # WP6 — Phase 2 agent registry
    ├── TaskStateMachine.js    # WP6 — Phase 2 execution state machine
    ├── PolicyEvaluator.js     # WP6 — Phase 2 default-deny governance
    ├── ToolBroker.js          # WP6 — Phase 2 sandboxed tool broker
    ├── ScopedMemory.js        # WP6 — Phase 2 namespace-isolated memory
    └── AIAdapter.js           # WP6 — Phase 2 provider-independent LLM bridge
```

> **Layout note:** `index.html`, `styles.css`, `app.js` live at repository **root** so the Owner Checklist Step 3 (GitHub Pages → Deploy from branch `main`, folder `/`) works with zero extra configuration. All engine modules live in `src/` behind ES module imports.

## 6. Mobile-First Setup (Android · github.dev · Zero CLI)

1. **Create the repository** on Chrome Android → `github.com/new` → name `boss-ai-platform` → **Private** → check *Add a README* → MIT License → Create.
2. **Launch the browser editor** — on the repo page press `.` (or open `github.dev/<you>/boss-ai-platform`).
3. **Paste the files** exactly at the paths shown in §5 (create `src/` and `icons/` folders inside the editor).
4. **Commit & Push** from the Source Control tab (e.g. `feat: initial release of personal productivity hub v1.0`).
5. **Enable hosting** — Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)` → Save. The app goes live at `https://<username>.github.io/boss-ai-platform/`.
6. **Verify on Android Chrome** — no horizontal scroll at 360–412px, touch targets ≥ 44×44px, Airplane Mode reload keeps the shell and data editable, and a JSON export → clear site data → import round-trip restores everything.

## 7. Usage Guide

| Tab | What you can do |
|---|---|
| **Dashboard** | Daily Focus (due today or High/Urgent), counters, quick-add task |
| **Tasks** | Create/edit/delete tasks; filter by status, priority, tag, text; validated workflow transitions |
| **Projects** | Create projects, link tasks, watch live completion %, archive immutably |
| **Notes** | Pin important notes, tag them, cross-link to projects/tasks |
| **More** | Global search entry, JSON export/import, storage meter, theme toggle, destructive reset (with confirm modal) |

Global search is also available from the header search button: results are grouped by entity type and tapping a result switches to the owning view.

## 8. Governance & Autonomy Matrix

| Class | Definition | Approval | Example actions |
|---|---|---|---|
| **A** | Autonomous Execution | None (immediate) | Task planning, documentation, client-side code generation, local QA scripts, static security analysis |
| **B** | Explicit Owner Approval | Single-use manual sign-off | External emails/webhooks, third-party accounts, API key changes, production deployments, any cost-incurring operation |
| **C** | Strictly Prohibited | **NEVER** | Privilege escalation, policy overrides, skipping approval gates, audit-log tampering, autonomous financial transactions, secret exfiltration |

## 9. Security Baseline

- **Default-Deny** access policy — deny unless an explicit rule permits.
- **Untrusted Input Defense** — all user entries, API payloads, and scraped content are sanitized before use; indirect prompt-injection vectors are treated as hostile.
- **DOM Injection Defense** — `innerHTML`, `outerHTML`, and `document.write` are banned; dynamic strings render via `textContent`, `setAttribute`, or `document.createElement`.
- **Zero Hardcoded Secrets** — keys enter via runtime memory or secure local input prompts only; missing configuration is tagged `[OWNER INPUT REQUIRED]`.
- **Quota & Cost Safeguards** — local usage tracking with hard stops before external rate limits; unverified provider thresholds tagged `[VERIFY AGAINST CURRENT PROVIDER TERMS]`.

## 10. QA & Release Gate

All 12 static audit tests (QA-01 → QA-12) are documented in [`QA-MATRIX-REPORT.md`](QA-MATRIX-REPORT.md). Release readiness and the Class B signature block live in [`RELEASE-GATE-V1.0.md`](RELEASE-GATE-V1.0.md).

## 11. Status Vocabulary & Evidence Rules

Accepted states: `Proposed` → `Approved` → `Implemented` → `Tested` → `Released` → `Verified`.

No step is reported complete (repository commits, test runs, deployments) unless executed in a real execution container. Static outputs are reported as: **"Code generated and ready for manual review and commit."**

## 12. License

MIT — see repository license selection during creation (Owner Checklist Step 1).
