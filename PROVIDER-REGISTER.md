# Provider Register — BOSS AI

| Field | Value |
|---|---|
| Document Version | 1.0.0 |
| Status | `Approved` |
| Date | 2026-11-22 |
| Governing Rule | **Zero-Spend Imperative** — free tiers only; never assume free quotas are permanent |

> **Tag policy:** every free-tier threshold that has not been re-verified against the provider's live terms page on the date of use MUST carry `[VERIFY AGAINST CURRENT PROVIDER TERMS]`. Any missing key/domain/credential MUST carry `[OWNER INPUT REQUIRED]` — never invent placeholder secrets.

---

## 1. Core Platform Providers

| Provider | Service Used | Free Tier Offer (summary) | Spec / Limits | Local Usage Tracking | Status |
|---|---|---|---|---|---|
| GitHub | Private repository `boss-ai-platform` | Unlimited private repos (free plan) | Repo soft limits apply | Commit cadence review | Active (Owner Checklist Step 1) |
| GitHub | GitHub Pages static hosting | Free for public repos; free-account Pages availability policy-dependent | Static files only; soft bandwidth limits | Page-load spot checks on Android | `[VERIFY AGAINST CURRENT PROVIDER TERMS]` |
| GitHub | github.dev browser editor | Included with repo access | Browser-only VS Code; no CLI needed | n/a | Active |
| Browser runtime | IndexedDB / LocalStorage | Free (device-local) | LocalStorage ≈ 5 MB; IndexedDB quota varies by device/browser | `BackupEngine.calculateStorageUsage()` meter + 80% warning banner | Active |
| Browser runtime | Service Worker / PWA cache | Free (device-local) | Cache quota varies; evictable under pressure | QA-12 offline verification | Active |

## 2. LLM Providers (Phase 2/3 runtime — via `src/AIAdapter.js`)

| Provider | Adapter | Free Tier Offer (summary) | Model / Context Window | Hard Limits | Status |
|---|---|---|---|---|---|
| OpenAI | `OpenAIAdapter` | Trial/promotional credit only; no permanent free API tier | e.g. `gpt-4o`-class models — context window and pricing vary by model | Rate limits per tier | `[VERIFY AGAINST CURRENT PROVIDER TERMS]` |
| Anthropic | `AnthropicAdapter` | Free credit via console signup (policy-dependent) | e.g. `claude-*` model family — context window varies by model | Rate limits per tier | `[VERIFY AGAINST CURRENT PROVIDER TERMS]` |
| Google Gemini | `GeminiAdapter` | Free tier with per-model daily request caps | e.g. `gemini-*` model family — context window varies by model | Daily request/RPM caps | `[VERIFY AGAINST CURRENT PROVIDER TERMS]` |
| Ollama (local) | `OllamaAdapter` | 100% free, runs on owner hardware | Model-dependent (device RAM bound) | Device thermals/RAM | Active — **zero-cost fallback of choice** |

**API keys:** none are stored in this repository. Keys are supplied at runtime via secure local input and held in memory only. Key provisioning is tagged `[OWNER INPUT REQUIRED]`.

## 3. Runtime Safeguards (client-side)

1. **Local usage meters** — `AIAdapter` counts calls/tokens per provider session; approaching the configured ceiling triggers a hard stop **before** the external rate limit (per Master System Context: Runtime Safeguards).
2. **Hard-stop budget** — default session budget is 0 spend; any paid call is a **Class B** action requiring single-use Owner approval.
3. **Provider swap discipline** — all engines depend on the abstract `complete(prompt, config)` / `stream(prompt, config)` interface only; switching providers never touches downstream code (ADR-001 boundary rules).
4. **Quota re-verification** — before each release, re-check every row tagged `[VERIFY AGAINST CURRENT PROVIDER TERMS]` and update this register with the verification date.

## 4. Verification Log

| Date | Item Verified | Result | Verified By |
|---|---|---|---|
| 2026-11-22 | Register created with tag discipline | `Implemented` | AI Agent (static authoring) |
| [OWNER INPUT REQUIRED] | GitHub Pages free-tier terms for target account | Pending | [OWNER INPUT REQUIRED] |
| [OWNER INPUT REQUIRED] | LLM provider quotas for chosen Phase 3 provider | Pending | [OWNER INPUT REQUIRED] |
