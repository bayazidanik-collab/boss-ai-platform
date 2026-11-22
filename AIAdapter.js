/**
 * AIAdapter.js — BOSS AI Phase 2 · Autonomous Agent Core
 * Provider-independent LLM bridge.
 *
 * Standard interface (all adapters):
 *   complete(prompt, config) -> Promise<{text, usage, provider, model}>
 *   stream(prompt, config)   -> AsyncGenerator<{delta, done}> (scaffold)
 *
 * Adapters: OpenAI · Anthropic · Gemini · Ollama (local, zero-cost).
 * Downstream code never touches provider schemas — swap freely.
 *
 * BUDGET SAFEGUARDS (Master System Context):
 *   - UsageTracker records calls/tokens per session and hard-stops before
 *     any configured ceiling (Runtime Safeguards).
 *   - Paid API calls are Class B actions; adapters refuse to send when the
 *     tracker is exhausted.
 *   - ZERO hardcoded secrets: apiKey arrives at runtime only. Missing keys
 *     are tagged [OWNER INPUT REQUIRED] — never invented.
 *   - Free-tier quotas vary and drift: [VERIFY AGAINST CURRENT PROVIDER TERMS].
 */

export const PROVIDERS = ['openai', 'anthropic', 'gemini', 'ollama'];
const OWNER_INPUT = '[OWNER INPUT REQUIRED]';

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
/* Base adapter                                                        */
/* ------------------------------------------------------------------ */

export default class AIAdapter {
  /**
   * @param {{apiKey?: string, baseUrl?: string, model?: string, usageTracker?: UsageTracker, fetchImpl?: function}} options
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || OWNER_INPUT;
    this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
    this.model = options.model || '';
    this.usageTracker = options.usageTracker instanceof UsageTracker ? options.usageTracker : new UsageTracker();
    this._fetch = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  }

  get hasCredentials() {
    return Boolean(this.apiKey) && this.apiKey !== OWNER_INPUT;
  }

  /** @throws when the session budget is exhausted (hard stop, pre-flight). */
  _preFlight() {
    if (!this.usageTracker.canSpend(0)) {
      throw new Error('AIAdapter: local usage limit reached — hard stop before external rate limits (Runtime Safeguards)');
    }
    if (!this._fetch) {
      throw new Error('AIAdapter: no fetch implementation available in this runtime');
    }
  }

  async complete(/* prompt, config */) {
    throw new Error('AIAdapter.complete(): not implemented — use a concrete provider adapter');
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
/* Concrete adapters                                                   */
/* ------------------------------------------------------------------ */

export class OpenAIAdapter extends AIAdapter {
  constructor(options = {}) {
    super({
      ...options,
      baseUrl: options.baseUrl || 'https://api.openai.com/v1',
      model: options.model || 'gpt-4o', // [VERIFY AGAINST CURRENT PROVIDER TERMS]
    });
    this.provider = 'openai';
  }

  async complete(prompt, config = {}) {
    this._preFlight();
    if (!this.hasCredentials) throw new Error('OpenAIAdapter: apiKey [OWNER INPUT REQUIRED]');
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
    return { text, usage, provider: this.provider, model: data.model || this.model };
  }
}

export class AnthropicAdapter extends AIAdapter {
  constructor(options = {}) {
    super({
      ...options,
      baseUrl: options.baseUrl || 'https://api.anthropic.com/v1',
      model: options.model || 'claude-sonnet-4-5', // [VERIFY AGAINST CURRENT PROVIDER TERMS]
    });
    this.provider = 'anthropic';
  }

  async complete(prompt, config = {}) {
    this._preFlight();
    if (!this.hasCredentials) throw new Error('AnthropicAdapter: apiKey [OWNER INPUT REQUIRED]');
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
    return { text, usage, provider: this.provider, model: data.model || this.model };
  }
}

export class GeminiAdapter extends AIAdapter {
  constructor(options = {}) {
    super({
      ...options,
      baseUrl: options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta',
      model: options.model || 'gemini-2.0-flash', // [VERIFY AGAINST CURRENT PROVIDER TERMS]
    });
    this.provider = 'gemini';
  }

  async complete(prompt, config = {}) {
    this._preFlight();
    if (!this.hasCredentials) throw new Error('GeminiAdapter: apiKey [OWNER INPUT REQUIRED]');
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
    return { text, usage, provider: this.provider, model };
  }
}

/** Local Ollama — the zero-cost fallback of choice (Zero-Spend Imperative). */
export class OllamaAdapter extends AIAdapter {
  constructor(options = {}) {
    super({
      ...options,
      baseUrl: options.baseUrl || 'http://localhost:11434',
      model: options.model || 'llama3.2', // [VERIFY AGAINST CURRENT PROVIDER TERMS]
    });
    this.provider = 'ollama';
    this.apiKey = options.apiKey || 'local'; // no cloud key; local daemon only
  }

  async complete(prompt, config = {}) {
    this._preFlight();
    const data = await this._sendJson(
      `${this.baseUrl}/api/generate`,
      {},
      { model: config.model || this.model, prompt: String(prompt), stream: false },
    );
    const text = typeof data.response === 'string' ? data.response : '';
    const usage = this.usageTracker.record(data.eval_count || 0);
    return { text, usage, provider: this.provider, model: config.model || this.model };
  }
}

/* ------------------------------------------------------------------ */
/* Factory — dynamic provider switching without downstream changes     */
/* ------------------------------------------------------------------ */

export function createAdapter(provider, options = {}) {
  switch (String(provider || '').toLowerCase()) {
    case 'openai': return new OpenAIAdapter(options);
    case 'anthropic': return new AnthropicAdapter(options);
    case 'gemini': return new GeminiAdapter(options);
    case 'ollama': return new OllamaAdapter(options);
    default:
      throw new Error(`createAdapter: unknown provider '${provider}' (expected one of ${PROVIDERS.join(', ')})`);
  }
}
