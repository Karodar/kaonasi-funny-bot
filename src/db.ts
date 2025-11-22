import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export class DB {
    db: Database.Database;

    constructor(filePath = './data/kaonasi.db') {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this.db = new Database(filePath);
        this.migrate();
    }

    private migrate() {
        // personas: id (TEXT primary key), name UNIQUE, prompt TEXT, keywords TEXT(JSON)
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS personas (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        prompt TEXT NOT NULL,
        keywords TEXT DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_personas_name ON personas(name);

      CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        persona_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        ts TEXT NOT NULL,
        FOREIGN KEY(persona_id) REFERENCES personas(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_persona ON memory(persona_id);
    `);
    }

    close() {
        this.db.close();
    }
}