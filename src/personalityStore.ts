import { DB } from './db';
import { v4 as uuidv4 } from 'uuid';

export type MemoryItem = {
    role: 'user' | 'bot';
    text: string;
    ts: string;
};

export type Personality = {
    id: string;
    name: string;
    prompt: string;
    keywords: string[]; // fallback matching
    memory?: MemoryItem[];
};

export class PersonalityStore {
    db: DB;

    constructor(dbFile?: string) {
        this.db = new DB(dbFile);
    }

    async list(): Promise<Personality[]> {
        const rows = this.db.db.prepare('SELECT id, name, prompt, keywords FROM personas ORDER BY name').all();
        return rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            prompt: r.prompt,
            keywords: JSON.parse(r.keywords || '[]'),
        }));
    }

    async getByName(name: string): Promise<Personality | null> {
        const r = this.db.db.prepare('SELECT id, name, prompt, keywords FROM personas WHERE lower(name)=lower(?)').get(name);
        if (!r) return null;
        const p: Personality = { id: r.id, name: r.name, prompt: r.prompt, keywords: JSON.parse(r.keywords || '[]') };
        p.memory = await this.getMemory(p.id, 50);
        return p;
    }

    async add(name: string, prompt: string, keywords: string[] = []): Promise<Personality> {
        // check exists
        const exists = this.db.db.prepare('SELECT 1 FROM personas WHERE lower(name)=lower(?)').get(name);
        if (exists) throw new Error('Persona already exists');
        const id = uuidv4();
        this.db.db.prepare('INSERT INTO personas (id, name, prompt, keywords) VALUES (?, ?, ?, ?)').run(
            id,
            name,
            prompt,
            JSON.stringify(keywords || [])
        );
        return { id, name, prompt, keywords };
    }

    async appendMemory(personaId: string, item: MemoryItem) {
        this.db.db.prepare('INSERT INTO memory (persona_id, role, text, ts) VALUES (?, ?, ?, ?)').run(
            personaId,
            item.role,
            item.text,
            item.ts
        );
        // Optionally trim memory to last N rows per persona (e.g., 200)
        const max = 200;
        const countRow = this.db.db.prepare('SELECT COUNT(*) as c FROM memory WHERE persona_id = ?').get(personaId);
        const count = countRow?.c || 0;
        if (count > max) {
            const toDelete = count - max;
            this.db.db.prepare(`
        DELETE FROM memory WHERE id IN (
          SELECT id FROM memory WHERE persona_id = ? ORDER BY id ASC LIMIT ?
        )
      `).run(personaId, toDelete);
        }
    }

    async getMemory(personaId: string, limit = 50): Promise<MemoryItem[]> {
        const rows = this.db.db.prepare('SELECT role, text, ts FROM memory WHERE persona_id = ? ORDER BY id DESC LIMIT ?').all(
            personaId,
            limit
        );
        // return in chronological order (oldest first)
        return rows.reverse().map((r: any) => ({ role: r.role as 'user' | 'bot', text: r.text, ts: r.ts }));
    }

    async clearMemory(personaName: string) {
        const persona = this.db.db.prepare('SELECT id FROM personas WHERE lower(name)=lower(?)').get(personaName);
        if (!persona) throw new Error('Persona not found');
        this.db.db.prepare('DELETE FROM memory WHERE persona_id = ?').run(persona.id);
    }

    async close() {
        this.db.close();
    }
}