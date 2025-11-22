// src/deepseekClient.ts
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
    this.baseUrl = cfg.baseUrl?.replace(/\/+/g, '') || undefined;
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

    const history = memory.map(m => ({ role: m.role, text: m.text }));
    const payload = {
      persona_name: persona.name,
      prompt: persona.prompt,
      history,
      input: userMessage,
      max_tokens: 512,
      temperature: 0.7,
    };

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
        if (resp?.data) {
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
          return JSON.stringify(d);
        }
      } catch (err: any) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('DeepSeek generate failed (no usable endpoint)');
  }

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
      }
    }
    return null;
  }

  // NEW: extract keywords for a persona prompt using DeepSeek.
  // Tries a /keywords endpoint first, otherwise asks the model to produce a comma-separated list.
  async extractKeywords(promptText: string, maxKeywords = 8): Promise<string[]> {
    if (!this.apiKey || !this.baseUrl) return [];
    const candidates = ['/keywords', '/v1/keywords'];
    for (const p of candidates) {
      try {
        const resp = await this.client.post(p, { prompt: promptText });
        if (resp?.data) {
          const d = resp.data;
          if (Array.isArray(d)) return d.map(String).slice(0, maxKeywords);
          if (d.keywords && Array.isArray(d.keywords)) return d.keywords.map(String).slice(0, maxKeywords);
          if (d.items && Array.isArray(d.items)) return d.items.map(String).slice(0, maxKeywords);
        }
      } catch {
      }
    }

    // Fallback: use generate endpoint to ask model for keywords
    const instruction = `Extract up to ${maxKeywords} concise keywords (single words or short phrases) that describe this persona. Respond as a comma-separated list without extra text. Persona description: ${promptText}`;
    const payload = { input: instruction, max_tokens: 60, temperature: 0.0 };
    const genCandidates = [this.generatePath, '/responses', '/generate', '/v1/responses', '/v1/generate'].filter(Boolean) as string[];
    for (const p of genCandidates) {
      try {
        const resp = await this.client.post(p, payload);
        const text = resp?.data;
        if (!text) continue;
        // try to extract string from common shapes
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
          // split by commas and newlines, sanitize
          const parts = out.split(/[
,;]+/).map(s => s.trim()).filter(Boolean);
          if (parts.length > 0) return parts.slice(0, maxKeywords);
        }
      } catch {
      }
    }

    return [];
  }
}