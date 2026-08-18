-- 0001_init.sql — dsh-doudizhu D1 初始迁移（M2）
-- 应用：cd worker && wrangler d1 migrations apply dsh-doudizhu

-- 玩家
CREATE TABLE IF NOT EXISTS players (
  uid          TEXT PRIMARY KEY,      -- 匿名 UID
  nickname     TEXT NOT NULL,
  avatar_id    TEXT NOT NULL,
  balance      INTEGER NOT NULL DEFAULT 0,
  peak_balance INTEGER NOT NULL DEFAULT 0,   -- 历史最高（段位/保底）
  rank_id      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Token 流水（只增不改）
CREATE TABLE IF NOT EXISTS token_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL,
  type          TEXT NOT NULL,   -- daily | game_in | game_out | rake | rescue
  delta         INTEGER NOT NULL, -- ±
  balance_after INTEGER NOT NULL,
  ref_id        TEXT,            -- 关联对局/领取幂等键
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_uid ON token_ledger(uid, id DESC);

-- 每日领取幂等
CREATE TABLE IF NOT EXISTS daily_claims (
  uid    TEXT NOT NULL,
  day    TEXT NOT NULL,          -- 'YYYY-MM-DD' (UTC+8)
  amount INTEGER NOT NULL,
  PRIMARY KEY (uid, day)
);

-- 对局
CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY,   -- 房间 id
  table_id    TEXT NOT NULL,      -- 桌别
  base_stake  INTEGER NOT NULL,
  multiplier  INTEGER NOT NULL,
  rake        INTEGER NOT NULL,
  players     TEXT NOT NULL,      -- JSON: [{uid, seat, role, result, delta}]
  winner      TEXT,
  finished_at INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_finish ON matches(finished_at);

-- 埋点事件明细
CREATE TABLE IF NOT EXISTS analytics_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  event     TEXT NOT NULL,
  uid       TEXT,
  ts        INTEGER NOT NULL,
  props     TEXT,               -- JSON
  event_id  TEXT UNIQUE,        -- 去重
  server_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_event_ts ON analytics_events(event, ts);
