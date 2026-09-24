import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SnapshotInput = {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  htmlHash: string;
  textHash: string;
  screenshotPath?: string;
  metadata?: Record<string, unknown>;
};

export type SnapshotRecord = SnapshotInput & {
  id: number;
  createdAt: string;
};

export class SnapshotStore {
  private db: Database.Database;
  readonly rootDir: string;
  readonly screenshotsDir: string;

  constructor(rootDir = path.resolve(process.cwd(), ".wpdesktop-mcp")) {
    this.rootDir = rootDir;
    this.screenshotsDir = path.join(rootDir, "screenshots");
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    this.db = new Database(path.join(rootDir, "snapshots.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        finalUrl TEXT NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        htmlHash TEXT NOT NULL,
        textHash TEXT NOT NULL,
        screenshotPath TEXT,
        metadataJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_url_created ON snapshots(url, createdAt DESC);
    `);
  }

  createSnapshot(input: SnapshotInput): SnapshotRecord {
    const info = this.db.prepare(`
      INSERT INTO snapshots (url, finalUrl, title, text, htmlHash, textHash, screenshotPath, metadataJson)
      VALUES (@url, @finalUrl, @title, @text, @htmlHash, @textHash, @screenshotPath, @metadataJson)
    `).run({
      ...input,
      screenshotPath: input.screenshotPath || null,
      metadataJson: JSON.stringify(input.metadata || {})
    });
    return this.getSnapshot(Number(info.lastInsertRowid))!;
  }

  getLatestSnapshot(url: string): SnapshotRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM snapshots WHERE url = ? ORDER BY datetime(createdAt) DESC, id DESC LIMIT 1
    `).get(url);
    return row ? this.mapRow(row as Row) : null;
  }

  getSnapshot(id: number): SnapshotRecord | null {
    const row = this.db.prepare("SELECT * FROM snapshots WHERE id = ?").get(id);
    return row ? this.mapRow(row as Row) : null;
  }

  listSnapshots(url?: string, limit = 20): SnapshotRecord[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = url
      ? this.db.prepare(`
          SELECT * FROM snapshots WHERE url = ? ORDER BY datetime(createdAt) DESC, id DESC LIMIT ?
        `).all(url, boundedLimit)
      : this.db.prepare(`
          SELECT * FROM snapshots ORDER BY datetime(createdAt) DESC, id DESC LIMIT ?
        `).all(boundedLimit);
    return rows.map((row) => this.mapRow(row as Row));
  }

  close(): void {
    this.db.close();
  }

  private mapRow(row: Row): SnapshotRecord {
    return {
      id: row.id,
      url: row.url,
      finalUrl: row.finalUrl,
      title: row.title,
      text: row.text,
      htmlHash: row.htmlHash,
      textHash: row.textHash,
      screenshotPath: row.screenshotPath || undefined,
      metadata: JSON.parse(row.metadataJson || "{}"),
      createdAt: row.createdAt
    };
  }
}

type Row = {
  id: number;
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  htmlHash: string;
  textHash: string;
  screenshotPath: string | null;
  metadataJson: string;
  createdAt: string;
};
