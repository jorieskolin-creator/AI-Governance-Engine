CREATE TABLE IF NOT EXISTS governance_runs (
  id TEXT PRIMARY KEY,
  state JSONB,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS governance_runs_expiry_idx
  ON governance_runs (expires_at)
  WHERE deleted_at IS NULL;
