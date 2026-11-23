/**
 * AIAdapter.js — BOSS AI Phase 2 · Autonomous Agent Core
 * Provider-independent LLM bridge with a DEFAULT OFFLINE / MOCK mode.
 *
 * Standard interface (all adapters):
 *   complete(prompt, config) -> Promise<{text, usage, provider, model}>
 *   run(task, config)        -> Promise<{text, usage, provider, model, task}>
 *   healthCheck()            -> Promise<{ok, mode, provider, model, usage, notes}>
 *
 * DEFAULT MODE: 'offline-mock' — deterministic, local, ZERO paid calls and
 * ZERO network traffic. External providers are opt-in and policy-gated:
 *   - Unapproved external network calls are CLASS_C (blocked) — a provider
 *     call only runs with config.ownerApproved: true.
 *   - paidPlan: true sets requiresPaidSpend and is BLOCKED by zero-spend policy.
 *   - UsageTracker hard-stops before any configured ceiling (Runtime Safeguards).
 *
 * ZERO hardcoded secrets: apiKey arrives at runtime only. Missing keys are
 * tagged [OWNER INPUT REQUIRED] — never invented.
 * Free-tier quotas vary and drift: [VERIFY AGAINST CURRENT PROVIDER TERMS].
 *
 * Security: DOM-free module (zero innerHTML / outerHTML / document.write).
 * Syntax: ES2017-safe (no ?? / ?. / Object.fromEntries / top-level await).
 */

import PolicyEvaluator from './PolicyEvaluator.js';

export const PROVIDERS = ['offline', 'openai', 'anthropic', 'gemini', 'ollama'];
const OWNER_INPUT = '[OWNER INPUT REQUIRED]';
const VERIFY = '[VERIFY AGAINST CURRENT PROVIDER TERMS]';

/* ------------------------------------------------------------------ */
/* UsageTracker — local quota monitor with hard stop                   */
/* ------------------------------------------------------------------ */

export class UsageTracker {
  /**
   * @param {{maxCalls?: number, maxTokens?: number}} [limits]
   *   Infinity defaults mean "meter only"; set finite values to hard-stop.
   */
  constructor(limits = {}) {
    this.maxCalls = Number.isFinite(limits.maxCalls) ? limits.maxCalls : Infinity;
    this.maxTokens = Number.isFinite(limits.maxTokens) ? limits.maxTokens : Infinity;
    this.calls = 0;
    this.tokens = 0;
  }

  canSpend(estimatedTokens = 0) {
    return this.calls + 1 <= this.maxCalls && this.tokens + estimatedTokens <= this.maxTokens;
  }

  record(tokens = 0) {
    this.calls += 1;
    this.tokens += Number.isFinite(tokens) ? tokens : 0;
    return this.summary();
  }

  summary() {
    return {
      calls: this.calls,
      tokens: this.tokens,
      maxCalls: this.maxCalls,
      maxTokens: this.maxTokens,
      exhausted: this.calls >= this.maxCalls || this.tokens >= this.maxTokens,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Base adapter — DEFAULT OFFLINE MOCK (zero paid calls)               */
/* ------------------------------------------------------------------ */

export default class AIAdapter {
  /**
   * @param {{mode?: 'offline-mock'|'external', provider?: string, apiKey?: string,
   *          baseUrl?: string, model?: string, paidPlan?: boolean,
   *          policyEvaluator?: PolicyEvaluator, usageTracker?: UsageTracker,
   *          fetchImpl?: function}} [options]
   */
  constructor(options = {}) {
    this.mode = options.mode === 'external' ? 'external' : 'offline-mock';
    this.provider = options.provider || 'offline-mock';
    this.apiKey = options.apiKey || OWNER_INPUT;
    this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
    this.model = options.model || 'mock-v1';
    this.paidPlan = options.paidPlan === true;
    this.policy = options.policyEvaluator instanceof PolicyEvaluator
      ? options.policyEvaluator
      : new PolicyEvaluator();
    this.usageTracker = options.usageTracker instanceof UsageTracker ? options.usageTracker : new UsageTracker();
    this._fetch = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  }

  get hasCredentials() {
    return Boolean(this.apiKey) && this.apiKey !== OWNER_INPUT;
  }

  /**
   * Pre-flight for EXTERNAL calls: usage hard-stop + policy gate.
   * Offline/mock mode never reaches this path.
   * @throws when policy blocks (CLASS_C unapproved external / zero-spend)
   *         or the local usage ceiling is exhausted.
   */
  _preFlightExternal(config = {}) {
    if (!this.usageTracker.canSpend(0)) {
      throw new Error('AIAdapter: local usage limit reached — hard stop before external rate limits (Runtime Safeguards)');
    }
    if (!this._fetch) {
      throw new Error('AIAdapter: no fetch implementation available in this runtime');
    }
    const verdict = this.policy.evaluate({
      action: 'external_api_call',
      externalNetwork: true,
      costEstimate: 0, // free-tier assumption — VERIFY AGAINST CURRENT PROVIDER TERMS
      requiresPaidSpend: this.paidPlan,
      ownerApproved: config.ownerApproved === true,
    });
    if (!verdict.allowed) {
      throw new Error(`AIAdapter: blocked by policy — ${verdict.reason}`);
    }
    return verdict;
  }

  /** Pre-flight for LOCAL calls (e.g. Ollama daemon): usage hard-stop only. */
  _preFlightLocal() {
    if (!this.usageTracker.canSpend(0)) {
      throw new Error('AIAdapter: local usage limit reached — hard stop (Runtime Safeguards)');
    }
    if (!this._fetch) {
      throw new Error('AIAdapter: no fetch implementation available in this runtime');
    }
  }

  /**
   * DEFAULT: deterministic offline mock. Zero paid calls, zero network.
   * External adapters override this and must pass _preFlightExternal().
   */
  async complete(prompt, config = {}) {
    const text = String(prompt == null ? '' : prompt);
    const trimmed = text.length > 160 ? text.slice(0, 160) + '…' : text;
    const usage = this.usageTracker.record(0);
    return {
      text: `[offline-mock · zero paid calls] processed: ${trimmed}`,
      usage,
      provider: this.provider,
      model: this.model,
      mode: this.mode,
    };
  }

  /**
   * Task runner: { goal, input?, format? } -> complete().
   * Local and deterministic in offline mode.
   */
  async run(task, config = {}) {
    const t = task || {};
    const goal = String(t.goal || t.prompt || '');
    const input = t.input === undefined ? '' : String(t.input);
    const format = t.format ? ` (output format: ${t.format})` : '';
    const prompt = `Goal: ${goal}${format}\nInput: ${input}`;
    const result = await this.complete(prompt, config);
    return { ...result, task: { goal, input, format: t.format || '' } };
  }

  /**
   * Health check — never performs paid/network calls in offline mode.
   * External modes report configuration state only (no network probe).
   */
  async healthCheck() {
    const notes = [];
    if (this.mode === 'offline-mock') {
      notes.push('offline-mock mode: zero paid calls, zero network traffic');
    } else {
      notes.push(`external provider '${this.provider}' — policy-gated; ownerApproved required per call`);
      notes.push(`free-tier limits ${VERIFY}`);
      notes.push(`model '${this.model}' availability ${VERIFY}`);
      if (!this.hasCredentials && this.provider !== 'ollama') notes.push(`apiKey ${OWNER_INPUT}`);
      if (this.paidPlan) notes.push('paidPlan enabled — zero-spend policy will BLOCK all calls');
    }
    return {
      ok: true,
      mode: this.mode,
      provider: this.provider,
      model: this.model,
      usage: this.usageTracker.summary(),
      notes,
    };
  }

  /** Streaming scaffold: override in concrete adapters. */
  async *stream(prompt, config = {}) {
    const result = await this.complete(prompt, config);
    yield { delta: result.text, done: true, usage: result.usage };
  }

  async _sendJson(url, headers, body) {
    const response = await this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`AIAdapter: provider returned HTTP ${response.status}`);
    }
    return response.json();
  }
}

/* ------------------------------------------------------------------ */
/* MockAdapter — explicit offline adapter (also the default)           */
/* ------------------------------------------------------------------ */

export class MockAdapter extends AIAdapter {
  constructor(options = {}) {
    super({ ...options, mode: 'offline-mock', provider: 'offline-mock', model: 'mock-v1' });
  }
}

/* ------------------------------------------------------------------ */
/* Concrete external adapters (policy-gated, ownerApproved required)   */
/* ------------------------------------------------------------------ */

export class OpenAIAdapter extends AIAdapter {
  constructor(options = {}) {
    super({
      ...options,
      mode: 'external',
      provider: 'openai',
      baseUrl: options.baseUrl || 'https://api.openai.com/v1',
      model: options.model || 'gpt-4o', // VERIFY AGAINST CURRENT PROVIDER TERMS
    });
  }

  async complete(prompt, config = {}) {
    this._preFlightExternal(config);
    if (!this.hasCredentials) throw new Error(`OpenAIAdapter: apiKey ${OWNER_INPUT}`);
    const data = await this._sendJson(
      `${this.baseUrl}/chat/completions`,
      { Authorization: `Bearer ${this.apiKey}` },
      {
        model: config.model || this.model,
        messages: [{ role: 'user', content: String(prompt) }],
        max_tokens: config.maxTokens || 1024,
      },
    );
    const text = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '';
    const usage = this.usageTracker.record(data.usage ? data.usage.total_tokens : 0);
    return { text, usage, provider: this.provider, model: data.model || this.model, mode: this.mode };
  }
}

export class AnthropicAdapter extends AIAdapter {
  constructor(options = {}) {
    super({
      ...options,
      mode: 'external',
      provider: 'anthropic',
      baseUrl: options.baseUrl || 'https://api.anthropic.com/v1',
      model: options.model || 'claude-sonnet-4-5', // VERIFY AGAINST CURRENT PROVIDER TERMS
    });
  }

  async complete(prompt, config = {}) {
    this._preFlightExternal(config);
    if (!this.hasCredentials) throw new Error(`AnthropicAdapter: apiKey ${OWNER_INPUT}`);
    const data = await this._sendJson(
      `${this.baseUrl}/messages`,
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: config.model || this.model,
        max_tokens: config.maxTokens || 1024,
        messages: [{ role: 'user', content: String(prompt) }],
      },
    );
    const text = data.content && data.content[0] && data.content[0].text ? data.content[0].text : '';
    const usage = this.usageTracker.record(data.usage ? (data.usage.input_tokens + data.usage.output_tokens) : 0);
    return { text, usage, provider: this.provider, model: data.model || this.model, mode: this.mode };
  }
}

export class GeminiAdapter extends AIAdapter {
  constructor(options = {}) {
    super({
      ...options,
      mode: 'external',
      provider: 'gemini',
      baseUrl: options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta',
      model: options.model || 'gemini-2.0-flash', // VERIFY AGAINST CURRENT PROVIDER TERMS
    });
  }

  async complete(prompt, config = {}) {
    this._preFlightExternal(config);
    if (!this.hasCredentials) throw new Error(`GeminiAdapter: apiKey ${OWNER_INPUT}`);
    const model = config.model || this.model;
    const data = await this._sendJson(
      `${this.baseUrl}/models/${model}:generateContent`,
      { 'x-goog-api-key': this.apiKey },
      { contents: [{ parts: [{ text: String(prompt) }] }] },
    );
    const parts = data.candidates && data.candidates[0] && data.candidates[0].content
      ? data.candidates[0].content.parts : [];
    const text = parts.map((p) => p.text || '').join('');
    const usage = this.usageTracker.record(data.usageMetadata ? data.usageMetadata.totalTokenCount : 0);
    return { text, usage, provider: this.provider, model, mode: this.mode };
  }
}

/**
 * Local Ollama — zero-cost local daemon (Zero-Spend Imperative).
 * Localhost traffic only; still usage-tracked and quota-checked.
 */
export class OllamaAdapter extends AIAdapter {
  constructor(options = {}) {
    super({
      ...options,
      mode: 'external',
      provider: 'ollama',
      baseUrl: options.baseUrl || 'http://localhost:11434',
      model: options.model || 'llama3.2', // VERIFY AGAINST CURRENT PROVIDER TERMS
    });
    this.apiKey = options.apiKey || 'local'; // no cloud key; local daemon only
  }

  async complete(prompt, config = {}) {
    this._preFlightLocal();
    const data = await this._sendJson(
      `${this.baseUrl}/api/generate`,
      {},
      { model: config.model || this.model, prompt: String(prompt), stream: false },
    );
    const text = typeof data.response === 'string' ? data.response : '';
    const usage = this.usageTracker.record(data.eval_count || 0);
    return { text, usage, provider: this.provider, model: config.model || this.model, mode: this.mode };
  }
}

/* ------------------------------------------------------------------ */
/* Factory — dynamic provider switching without downstream changes     */
/* ------------------------------------------------------------------ */

export function createAdapter(provider, options = {}) {
  switch (String(provider || '').toLowerCase()) {
    case 'offline':
    case 'mock':
    case '': return new MockAdapter(options);
    case 'openai': return new OpenAIAdapter(options);
    case 'anthropic': return new AnthropicAdapter(options);
    case 'gemini': return new GeminiAdapter(options);
    case 'ollama': return new OllamaAdapter(options);
    default:
      throw new Error(`createAdapter: unknown provider '${provider}' (expected one of ${PROVIDERS.join(', ')})`);
  }
}
