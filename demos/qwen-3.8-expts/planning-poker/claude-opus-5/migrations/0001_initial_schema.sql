-- Room registry and round history.
--
-- Live room state lives in the PokerRoom Durable Object, not here. D1 answers
-- two questions the DO cannot: "has this room code ever existed?" (after the DO
-- is evicted) and "what did we estimate last sprint?".
--
-- No CHECK constraints anywhere: they are immutable in SQLite/D1 and dropping
-- one means rebuilding the table. Enum and range validation lives in the Worker.

CREATE TABLE rooms (
  code           TEXT PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT 'Planning session',
  deck_id        TEXT NOT NULL DEFAULT 'fibonacci',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted        INTEGER NOT NULL DEFAULT 0,
  deleted_at     TEXT
);

CREATE INDEX idx_rooms_last_active ON rooms (last_active_at DESC);

CREATE TABLE rounds (
  id           TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  room_code    TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  issue_key    TEXT,
  issue_title  TEXT,
  deck_id      TEXT NOT NULL,
  -- [{ "name": "Ada", "vote": "5" }, ...] as played at reveal time.
  votes_json   TEXT NOT NULL DEFAULT '[]',
  average      REAL,
  consensus    INTEGER NOT NULL DEFAULT 0,
  voter_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted      INTEGER NOT NULL DEFAULT 0,
  deleted_at   TEXT,
  FOREIGN KEY (room_code) REFERENCES rooms (code)
);

CREATE INDEX idx_rounds_room ON rounds (room_code, id DESC);
CREATE INDEX idx_rounds_created ON rounds (created_at DESC);
