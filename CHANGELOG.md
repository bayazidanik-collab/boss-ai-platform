# Changelog — BOSS AI

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet — next milestone is Phase 2 orchestrator layer (Phase 3 roadmap item)._

## [1.0.0] - 2026-11-22

### Added — Phase 0 (Governance & Foundations)
- `README.md` — platform overview, architecture blueprint, mobile-first setup, governance summary.
- `PRD.md` — full product requirements for Phase 0–5, personas, NFRs, success metrics.
- `ADR-LOG.md` — ADR-001 (Modular Monolith SPA), ADR-002 (StorageAdapter abstraction), ADR-003 (Android-First UI).
- `RISK-REGISTER.md` — 15 catalogued risks (Security, Provider, Operational, Data Integrity) with mitigations.
- `PROVIDER-REGISTER.md` — free-tier provider inventory with `[VERIFY AGAINST CURRENT PROVIDER TERMS]` discipline.

### Added — Phase 1 (Personal Productivity Hub v1.0)
- `index.html`, `styles.css`, `app.js` — mobile-first app shell (360px–412px, ≥44×44px touch targets, sticky header, bottom navigation, dark/light theme, safe DOM rendering only).
- `src/StorageAdapter.js` — IndexedDB-with-LocalStorage-fallback persistence: atomic writes, `schemaVersion: 1`, `crypto.randomUUID()`, ISO 8601 timestamps, `ownerId`/`tenantId` scoping, `QuotaExceededError` handling.
- `src/TaskEngine.js` — task CRUD, priority levels, validated status workflow, tags, due dates, filters, `getDailyFocus()`.
- `src/ProjectEngine.js` — project CRUD, status management, task linking, `calculateProgress()`, archive immutability.
- `src/NoteEngine.js` — note CRUD with pinning, tags, project/task cross-linking.
- `src/SearchEngine.js` — real-time cross-entity search with grouped results and highlight metadata.
- `src/BackupEngine.js` — validated JSON export/import, malformed-payload rejection, storage usage meter with 80% warning.
- `manifest.webmanifest`, `sw.js`, `icons/icon.svg` — offline PWA shell with versioned cache.

### Added — Phase 1.5 (Quality & Security Gates)
- `QA-MATRIX-REPORT.md` — static audit matrix for QA-01 → QA-12 with evidence and mitigations.
- `RELEASE-GATE-V1.0.md` — release readiness summary and Class B Owner approval block.

### Added — Phase 2 (Autonomous Agent Core framework modules)
- `src/AgentRegistry.js` — agent registration with capabilities, allowed tools, context scope.
- `src/TaskStateMachine.js` — enforced `Pending → PolicyCheck → Executing → AwaitingOwnerApproval → Completed/Failed` lifecycle with transition log.
- `src/PolicyEvaluator.js` — default-deny Class A/B/C governance evaluator.
- `src/ToolBroker.js` — policy-gated sandboxed tool execution with append-only audit log.
- `src/ScopedMemory.js` — namespace-isolated memory with multi-tenant tagging and authorization.
- `src/AIAdapter.js` — provider-independent LLM bridge (OpenAI, Anthropic, Gemini, Ollama) with local usage metering.

### Security
- DOM rendering is structurally XSS-safe (`innerHTML`/`outerHTML`/`document.write` prohibited across the codebase).
- Zero hardcoded secrets; all credentials enter at runtime and are tagged `[OWNER INPUT REQUIRED]` where missing.

[Unreleased]: https://github.com/<owner>/boss-ai-platform/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/<owner>/boss-ai-platform/releases/tag/v1.0.0
