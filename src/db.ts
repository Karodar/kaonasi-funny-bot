import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

export class DB {
    private SQL: any;
    private db: any;
    private filePath: string;

    constructor(filePath = './data/kaonasi.sqlite.bin') {
        this.filePath = filePath;
    }

    async init() {
        if (this.db) return;
        // initSqlJs returns a factory; it will locate the wasm automatically from node_modules/sql.js/dist
        this.SQL = await (initSqlJs as any)();
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        if (fs.existsSync(this.filePath)) {
            const fileBuffer = fs.readFileSync(this.filePath);
            this.db = new this.SQL.Database(new Uint8Array(fileBuffer));
        } else {
            this.db = new this.SQL.Database();
            this.db.run(`
        CREATE TABLE IF NOT EXISTS personas (
          id TEXT PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          prompt TEXT NOT NULL,
          keywords TEXT DEFAULT '[]'
        );
      `);
            this.db.run(`
        CREATE TABLE IF NOT EXISTS memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          persona_id TEXT NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          ts TEXT NOT NULL
        );
      `);
            this.persist();
        }
    }

    run(sql: string, params: any[] = []) {
        if (!this.db) throw new Error('DB not initialized');
        const stmt = this.db.prepare(sql);
        try {
            stmt.bind(params);
            // step() executes the statement; for INSERT/DELETE the return value isn't critical here
            const res = stmt.step();
            return res;
        } finally {
            stmt.free();
        }
    }

    query(sql: string, params: any[] = []) {
        if (!this.db) throw new Error('DB not initialized');
        const stmt = this.db.prepare(sql);
        try {
            stmt.bind(params);
            const rows: any[] = [];
            while (stmt.step()) {
                rows.push(stmt.getAsObject());
            }
            return rows;
        } finally {
            stmt.free();
        }
    }

    persist() {
        if (!this.db) throw new Error('DB not initialized');
        const data = this.db.export();
        fs.writeFileSync(this.filePath, Buffer.from(data));
    }

    close() {
        if (this.db) this.db.close();
    }
}