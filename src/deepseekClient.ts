import axios, { AxiosInstance } from 'axios';
import { Personality, MemoryItem } from './personalityStore';

type ClientConfig = {
  apiKey?: string;
  baseUrl?: string; // e.g. https://api.deepseek.com/v1
  generatePath?: string; // e.g. /responses or /generate
  relevancePath?: string; // optional endpoint for relevance scoring
  timeoutMs?: number;
};

export class DeepSeekClient {
  apiKey?: string;
  baseUrl?: string;
  client: AxiosInstance;
  generatePath?: string;
  relevancePath?: string;

  constructor(cfg: ClientConfig = {}) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl?.replace(/\/+$/, '') || undefined;
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

  async generateReply(persona: Personality, userMessage: string, memory: MemoryItem[]): Promise<string> {
    if (!this.apiKey || !this.baseUrl) {
      throw new Error('DeepSeek not configured (apiKey or baseUrl missing)');
    }

    // Formulate payload: include persona prompt and recent memory
    const history = memory.map(m => ({ role: m.role, text: m.text }));
    const payload = {
      // flexible shape: DeepSeek docs provide a 'prompt' + 'messages' style or 'input'
      persona_name: persona.name,
      prompt: persona.prompt,
      history,
      input: userMessage,
      // optional params for shorter output, etc.
      max_tokens: 512,
      temperature: 0.7,
    };

    // Try candidate endpoints in order: configured generatePath, /responses, /generate
    const candidates = [
      this.generatePath,
      '/responses',
      '/generate',
      '/v1/responses',
      '/v1/generate'
    ].filter(Boolean) as string[];

    let lastErr: any = null;
    for (const p of candidates) {
      try {
        const resp = await this.client.post(p, payload);
        // Try to extract sensible reply from common shapes.
        if (resp?.data) {
          // Typical shapes:
          // { reply: "..." } or { output: "..." } or { data: { text: "..." }} or OpenAI-like {choices:[{text:"..."}]}
          const d = resp.data;
          if (typeof d === 'string') return d;
          if (d.reply) return String(d.reply);
          if (d.output) return String(d.output);
          if (d.result) {
            if (typeof d.result === 'string') return d.result;
            if (d.result.output) return String(d.result.output);
          }
          if (d.data && typeof d.data === 'object') {
            if (d.data.text) return String(d.data.text);
            if (Array.isArray(d.data) && d.data[0] && d.data[0].text) return String(d.data[0].text);
          }
          if (Array.isArray(d.choices) && d.choices[0]) {
            if (d.choices[0].text) return String(d.choices[0].text);
            if (d.choices[0].message?.content) return String(d.choices[0].message.content);
          }
          // fallback to JSON-stringify if nothing matched
          return JSON.stringify(d);
        }
      } catch (err: any) {
        lastErr = err;
        // try next candidate
      }
    }
    throw lastErr || new Error('DeepSeek generate failed (no usable endpoint)');
  }

  // Optional: query a relevance endpoint to obtain 0..1 score, or null if not available
  async relevanceScore(persona: Personality, message: string): Promise<number | null> {
    if (!this.apiKey || !this.baseUrl) return null;
    const payload = { persona_name: persona.name, prompt: persona.prompt, message };
    const candidates = [
      this.relevancePath,
      '/relevance',
      '/v1/relevance',
      '/assess'
    ].filter(Boolean) as string[];
    for (const p of candidates) {
      try {
        const resp = await this.client.post(p, payload);
        if (resp?.data) {
          const d = resp.data;
          if (typeof d.score === 'number') return d.score;
          if (typeof d.relevance === 'number') return d.relevance;
          if (d.scores && typeof d.scores[0] === 'number') return d.scores[0];
        }
      } catch {
        // ignore and try next
      }
    }
    return null;
  }
}