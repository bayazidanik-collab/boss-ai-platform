# Risk Register — BOSS AI

| Field | Value |
|---|---|
| Document Version | 1.0.0 |
| Status | `Approved` |
| Date | 2026-11-22 |
| Scale — Impact / Likelihood | High · Medium · Low |

---

| Risk ID | Category | Risk Description | Impact | Likelihood | Mitigation Strategy |
|---|---|---|---|---|---|
| R-01 | Data Integrity | **Client storage quota exhaustion** (LocalStorage ~5 MB / IndexedDB eviction) causes silent write failure and data loss | High | Medium | `StorageAdapter` intercepts `QuotaExceededError` and raises user alerts; `BackupEngine.calculateStorageUsage()` shows an 80% warning banner; regular JSON exports encouraged (More tab) |
| R-02 | Data Integrity | **Single-device single-copy data** — phone loss/theft/factory reset wipes the only dataset | High | Medium | Validated JSON export engine (one-tap backup to Android Downloads or Google Drive); import round-trip verified in QA-07/QA-08; backup cadence documented in README §7 |
| R-03 | Data Integrity | **Malformed/tampered backup import** corrupts active state | High | Low | `importData()` performs strict structural + type validation **before any mutation**; corrupted payloads rejected atomically (QA-08); destructive replace only behind explicit confirm modal |
| R-04 | Security | **DOM-based XSS** via malicious task/note/search text executing script in the app origin | High | Low | Absolute ban on `innerHTML`/`outerHTML`/`document.write`; all dynamic strings rendered via `createElement`/`textContent`/`setAttribute`; QA-10 static sink scan must return zero findings |
| R-05 | Security | **Indirect prompt injection** — untrusted content (notes, imported data, future scraped text) smuggles instructions into LLM prompts in Phase 2+ | High | Medium | `PolicyEvaluator` + `ToolBroker` gate every tool action (Class A/B/C); untrusted content is labeled and wrapped as data, never as instructions; Class C forbids policy overrides; owner Class B gate for external effects |
| R-06 | Security | **Hardcoded secret leakage** in source committed to the repo | High | Low | Zero-hardcoded-secrets rule enforced by QA-11 static scan; keys enter at runtime only; missing configuration tagged `[OWNER INPUT REQUIRED]`; repo stays **Private** (Owner Checklist Step 1) |
| R-07 | Provider | **Free-tier quota/terms drift** — LLM or hosting providers change limits, pricing, or availability without notice | Medium | High | `PROVIDER-REGISTER.md` marks every unverified threshold `[VERIFY AGAINST CURRENT PROVIDER TERMS]`; runtime usage meters with hard stops before external limits; `AIAdapter` abstraction allows instant provider swapping |
| R-08 | Provider | **GitHub Pages/github.dev availability change** breaks the zero-CLI workflow | Medium | Low | Architecture is host-agnostic static files (any static host works); all logic client-side; ADR-001 consequences documented |
| R-09 | Operational | **Context fragmentation on single-device workflow** — owner loses AI session context mid-build | Medium | High | This blueprint bundles system governance + specs + prompt packs into one context container; Prompt 0 bootstraps any agent session in one paste |
| R-10 | Operational | **Copy-paste corruption** during github.dev transfer (truncated files, broken modules) | Medium | Medium | Deliverables are single-file, dependency-free ES modules; README §5 exact path manifest; syntax-checkable before commit; QA-09/QA-10 scans catch structural damage |
| R-11 | Operational | **Offline shell drift** — service worker serves stale cache after updates | Low | Medium | Versioned cache name (`boss-ai-shell-v1`) with `activate` cleanup; `skipWaiting` on update; cache strategy: cache-first shell, network-fallback with runtime refresh (QA-12) |
| R-12 | Operational | **Approval-gate bypass** — autonomous agent performs Class B/C actions without sign-off | High | Low | Class matrix is non-negotiable; `TaskStateMachine` enforces `AwaitingOwnerApproval` state; `ToolBroker` refuses uncleared payloads and writes append-only audit entries; Class C actions are structurally rejected |
| R-13 | Data Integrity | **Schema evolution breaks old backups** | Medium | Low | `schemaVersion` pinned in export meta; import rejects versions newer than runtime (`schemaVersion` guard) and validates per-record types; migrations planned per ADR-002 |
| R-14 | Security | **Audit log tampering** erases evidence of agent misbehavior | High | Low | Phase 2 `ToolBroker` audit log is append-only (no update/delete API surface); Class C explicitly prohibits audit-log modification; QA-11 style review checks API surface |
| R-15 | Provider | **Browser storage eviction policy** (browser clears "site data" under storage pressure) | Medium | Medium | Backup-first workflow documented; PWA uses cache, not persistent storage locks — `navigator.storage.persist()` attempted opportunistically in `BackupEngine.calculateStorageUsage()` reporting |

---

## Review Cadence

- Re-score risks at every release gate (`RELEASE-GATE-V1.0.md` review).
- New provider keys or external integrations require a register update **before** use.
