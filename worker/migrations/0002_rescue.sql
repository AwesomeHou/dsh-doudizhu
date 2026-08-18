-- 0002_rescue.sql — 破产救济每日幂等（M2）
CREATE TABLE IF NOT EXISTS rescue_claims (
  uid    TEXT NOT NULL,
  day    TEXT NOT NULL,          -- 'YYYY-MM-DD' (UTC+8)
  amount INTEGER NOT NULL,
  PRIMARY KEY (uid, day)
);
