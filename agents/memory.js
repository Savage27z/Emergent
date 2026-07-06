// agents/memory.js — the memory stream, first piece of the generative-agents
// pattern (memory stream → retrieval → reflection → planning).
//
// An agent's memory is an append-only log of observations. Later stages read
// from it: retrieval scores memories by recency + importance + relevance,
// reflection periodically summarizes them into higher-level thoughts, and the
// planner turns those into actions. This module is deliberately standalone —
// no game imports — so prompts and retrieval can be tested without the server
// (see agents/demo.js).
const { DatabaseSync } = require('node:sqlite');

class MemoryStream {
  /** @param {string} dbPath path to a SQLite file (shared with the world db is fine) */
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,          -- observation | reflection | plan
        text TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_memories_agent_ts ON memories (agent_id, ts);
    `);
    this._insert = this.db.prepare(
      'INSERT INTO memories (agent_id, ts, kind, text, importance) VALUES (?, ?, ?, ?, ?)'
    );
    this._recent = this.db.prepare(
      'SELECT ts, kind, text, importance FROM memories WHERE agent_id = ? ORDER BY ts DESC, id DESC LIMIT ?'
    );
    this._count = this.db.prepare('SELECT COUNT(*) AS n FROM memories WHERE agent_id = ?');
  }

  /** Record an observation (or reflection/plan) for an agent. */
  observe(agentId, text, { importance = 1, kind = 'observation', ts = Date.now() } = {}) {
    this._insert.run(agentId, ts, kind, text, importance);
  }

  /** Most recent memories, newest first. */
  recent(agentId, limit = 25) {
    return this._recent.all(agentId, limit);
  }

  count(agentId) {
    return this._count.get(agentId).n;
  }

  // Retrieval — the second stage of the pattern. Score = recency + importance
  // (+ relevance once we have embeddings; TODO in the LLM phase).
  retrieve(agentId, limit = 10) {
    const now = Date.now();
    const HOUR = 3600_000;
    return this.recent(agentId, 200)
      .map((m) => ({
        ...m,
        score: Math.exp(-(now - m.ts) / HOUR) * 2 + m.importance,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

module.exports = { MemoryStream };
