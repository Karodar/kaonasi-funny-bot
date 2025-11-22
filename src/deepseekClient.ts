import axios, { AxiosInstance } from 'axios';
import { Personality, MemoryItem } from './personalityStore';

type ClientConfig = {
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  generatePath?: string;
  relevancePath?: string;
  timeoutMs?: number;
};

export class DeepSeekClient {
  apiKey?: string;
  baseUrl?: string;
  client: AxiosInstance;
  modelName?: string;
  generatePath?: string;
  relevancePath?: string;

  constructor(cfg: ClientConfig = {}) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl?.replace(/\/+$/, '') || undefined;
    this.modelName = cfg.modelName;
    this.generatePath = cfg.generatePath;
    this.relevancePath = cfg.relevancePath;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: cfg.timeoutMs || 15_000,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
    });
  }

  private isOpenRouter() {
    if (!this.baseUrl) return false;
    return this.baseUrl.includes('openrouter') || this.baseUrl.includes('openrouter.ai') || Boolean(process.env.OPENROUTER_TOKEN);
  }

  async generateReply(persona: Personality, userMessage: string, memory: MemoryItem[]): Promise<string> {
    if (this.isOpenRouter()) {
      const messages = [
        { role: 'system', content: `You are ${persona.name}. ${persona.prompt}` },
        ...memory.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
        { role: 'user', content: userMessage }
      ];
      const model = this.modelName || process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
      const resp = await this.client.post('/v1/chat/completions', {
        model,
        messages,
        temperature: 0.7,
        max_tokens: 512
      }, {
        headers: {
          Authorization: `Bearer ${this.apiKey || process.env.OPENROUTER_TOKEN}`
        }
      });
      const d = resp.data;
      if (d?.choices && d.choices[0]) {
        const msg = d.choices[0].message?.content || d.choices[0].text;
        return String(msg || JSON.stringify(d)).trim();
      }
      return JSON.stringify(d);
    }

    // Fallback: try DeepSeek endpoints
    const payload = {
      persona_name: persona.name,
      prompt: persona.prompt,
      history: memory.map(m => ({ role: m.role, text: m.text })),
      input: userMessage,
    };
    const candidates = [this.generatePath, '/responses', '/generate', '/v1/responses', '/v1/generate'].filter(Boolean) as string[];
    let lastErr: any = null;
    for (const p of candidates) {
      try {
        const resp = await this.client.post(p, payload);
        const d = resp.data;
        if (!d) continue;
        if (d.reply) return String(d.reply);
        if (d.output) return String(d.output);
        if (Array.isArray(d.choices) && d.choices[0]) {
          if (d.choices[0].text) return String(d.choices[0].text);
          if (d.choices[0].message?.content) return String(d.choices[0].message.content);
        }
        return JSON.stringify(d);
      } catch (e: any) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('DeepSeek generate failed');
  }

  async extractKeywords(promptText: string, maxKeywords = 8): Promise<string[]> {
    if (this.isOpenRouter()) {
      const system = `Extract up to ${maxKeywords} concise keywords (single words or short phrases) that describe this persona. Respond as a comma-separated list without extra text. Persona description: ${promptText}`;
      const model = this.modelName || process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
      const resp = await this.client.post('/v1/chat/completions', {
        model,
        messages: [{ role: 'user', content: system }],
        temperature: 0.0,
        max_tokens: 60
      }, {
        headers: {
          Authorization: `Bearer ${this.apiKey || process.env.OPENROUTER_TOKEN}`
        }
      });
      const d = resp.data;
      let out: string | null = null;
      if (d?.choices && d.choices[0]) {
        out = d.choices[0].message?.content || d.choices[0].text || null;
      } else if (typeof d === 'string') out = d;
      if (out) {
        const parts = out.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
        return parts.slice(0, maxKeywords);
      }
      return [];
    }

    const candidates = ['/keywords', '/v1/keywords'];
    for (const p of candidates) {
      try {
        const resp = await this.client.post(p, { prompt: promptText });
        const d = resp.data;
        if (Array.isArray(d)) return d.map(String).slice(0, maxKeywords);
        if (d?.keywords && Array.isArray(d.keywords)) return d.keywords.map(String).slice(0, maxKeywords);
        if (d?.items && Array.isArray(d.items)) return d.items.map(String).slice(0, maxKeywords);
      } catch {}
    }

    const instruction = `Extract up to ${maxKeywords} concise keywords (single words or short phrases) that describe this persona. Respond as a comma-separated list without extra text. Persona description: ${promptText}`;
    const genCandidates = [this.generatePath, '/responses', '/generate', '/v1/responses', '/v1/generate'].filter(Boolean) as string[];
    for (const p of genCandidates) {
      try {
        const resp = await this.client.post(p, { input: instruction, max_tokens: 60, temperature: 0.0 });
        const text = resp.data;
        if (!text) continue;
        let out: string | null = null;
        if (typeof text === 'string') out = text;
        else if (text.reply) out = String(text.reply);
        else if (text.output) out = String(text.output);
        else if (Array.isArray(text.choices) && text.choices[0]) {
          out = text.choices[0].text || text.choices[0].message?.content || null;
        } else if (text.data && typeof text.data === 'object') {
          out = text.data.text || (Array.isArray(text.data) && text.data[0] && text.data[0].text) || null;
        }
        if (out) {
          const parts = out.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
          if (parts.length > 0) return parts.slice(0, maxKeywords);
        }
      } catch {}
    }
    return [];
  }

  async relevanceScore(persona: Personality, message: string): Promise<number | null> {
    if (this.isOpenRouter()) return null;

    if (!this.apiKey || !this.baseUrl) return null;
    const candidates = [this.relevancePath, '/relevance', '/v1/relevance', '/assess'].filter(Boolean) as string[];
    for (const p of candidates) {
      try {
        const resp = await this.client.post(p, { persona_prompt: persona.prompt, message });
        const d = resp.data;
        if (typeof d?.score === 'number') return d.score;
        if (typeof d?.relevance === 'number') return d.relevance;
        if (d?.scores && typeof d.scores[0] === 'number') return d.scores[0];
      } catch {}
    }
    return null;
  }
}