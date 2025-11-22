import { v4 as uuidv4 } from 'uuid';
import { DB } from './db';

export type MemoryItem = {
    role: 'user' | 'bot';
    text: string;
    ts: string;
};

export type Personality = {
    id: string;
    name: string;
    prompt: string;
    keywords: string[];
    memory?: MemoryItem[];
};

export class PersonalityStore {
    db: DB;

    constructor(dbFile?: string) {
        this.db = new DB(dbFile);
    }

    async init() {
        await this.db.init();
    }

    async list(): Promise<Personality[]> {
        await this.init();
        const rows = this.db.query('SELECT id, name, prompt, keywords FROM personas ORDER BY name', []);
        return rows.map((r: any) => ({ id: r.id, name: r.name, prompt: r.prompt, keywords: JSON.parse(r.keywords || '[]') }));
    }

    async getByName(name: string): Promise<Personality | null> {
        await this.init();
        const r = this.db.query('SELECT id, name, prompt, keywords FROM personas WHERE lower(name) = lower(?)', [name])[0];
        if (!r) return null;
        const p: Personality = { id: r.id, name: r.name, prompt: r.prompt, keywords: JSON.parse(r.keywords || '[]') };
        p.memory = await this.getMemory(p.id, 50);
        return p;
    }

    async add(name: string, prompt: string, keywords: string[] = []): Promise<Personality> {
        await this.init();
        const exists = this.db.query('SELECT 1 FROM personas WHERE lower(name)=lower(?) LIMIT 1', [name]);
        if (exists && exists.length > 0) throw new Error('Persona already exists');
        const id = uuidv4();
        this.db.run('INSERT INTO personas (id, name, prompt, keywords) VALUES (?, ?, ?, ?)', [id, name, prompt, JSON.stringify(keywords || [])]);
        this.db.persist();
        return { id, name, prompt, keywords };
    }

    async appendMemory(personaId: string, item: MemoryItem) {
        await this.init();
        this.db.run('INSERT INTO memory (persona_id, role, text, ts) VALUES (?, ?, ?, ?)', [personaId, item.role, item.text, item.ts]);
        const rows = this.db.query('SELECT COUNT(*) as c FROM memory WHERE persona_id = ?', [personaId]);
        const count = rows && rows[0] ? Number(rows[0].c) : 0;
        const max = 200;
        if (count > max) {
            const toDelete = count - max;
            const ids = this.db.query('SELECT id FROM memory WHERE persona_id = ? ORDER BY id ASC LIMIT ?', [personaId, toDelete]).map((r: any) => r.id);
            if (ids.length > 0) {
                this.db.run(`DELETE FROM memory WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
            }
        }
        this.db.persist();
    }

    async getMemory(personaId: string, limit = 50): Promise<MemoryItem[]> {
        await this.init();
        const rows = this.db.query('SELECT role, text, ts FROM memory WHERE persona_id = ? ORDER BY id DESC LIMIT ?', [personaId, limit]);
        return rows.reverse().map((r: any) => ({ role: r.role as 'user' | 'bot', text: r.text, ts: r.ts }));
    }

    async clearMemory(personaName: string) {
        await this.init();
        const rows = this.db.query('SELECT id FROM personas WHERE lower(name)=lower(?)', [personaName]);
        if (!rows || rows.length === 0) throw new Error('Persona not found');
        const personaId = rows[0].id;
        this.db.run('DELETE FROM memory WHERE persona_id = ?', [personaId]);
        this.db.persist();
    }
}