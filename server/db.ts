import { Pool } from "pg";

export type AnalysisLens = "wildlife" | "habitat";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export type WildlifeObservation = {
  start: number;
  end: number;
  species: string;
  count: number | null;
  behavior: string;
  environment: string;
  threat: string;
  confidence: number;
  summary: string;
};

export type WildlifeJob = {
  id: string;
  sourceName: string;
  sourceUrl: string;
  lens: AnalysisLens;
  status: JobStatus;
  stage: string;
  progress: number;
  videoId: string | null;
  durationSeconds: number | null;
  streamUrl: string | null;
  evidenceUrl: string | null;
  sceneIndexId: string | null;
  observations: WildlifeObservation[];
  error: string | null;
  workflowRunId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type PersistedWebhookEvent = {
  id: string;
  tier: number;
  label: string;
  eventId: string | null;
  confidence: number | null;
  explanation: string | null;
  startTime: number | null;
  endTime: number | null;
  streamUrl: string | null;
  videoId: string | null;
  receivedAt: string;
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not configured");

const globalForPool = globalThis as unknown as { wildwatchPool?: Pool };
export const pool = globalForPool.wildwatchPool ?? new Pool({
  connectionString,
  max: 3,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000,
});
if (process.env.NODE_ENV !== "production") globalForPool.wildwatchPool = pool;

let schemaReady: Promise<void> | undefined;

export function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wildlife_jobs (
        id uuid PRIMARY KEY,
        client_hash text NOT NULL,
        idempotency_key text NOT NULL,
        source_name text NOT NULL DEFAULT 'WildWatch observation',
        source_url text NOT NULL,
        lens text NOT NULL CHECK (lens IN ('wildlife', 'habitat')),
        status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
        stage text NOT NULL,
        progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        video_id text,
        duration_seconds double precision,
        stream_url text,
        evidence_url text,
        scene_index_id text,
        observations jsonb NOT NULL DEFAULT '[]'::jsonb,
        error text,
        workflow_run_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz,
        UNIQUE (client_hash, idempotency_key)
      );
      ALTER TABLE wildlife_jobs ADD COLUMN IF NOT EXISTS source_name text NOT NULL DEFAULT 'WildWatch observation';
      ALTER TABLE wildlife_jobs ADD COLUMN IF NOT EXISTS archived_at timestamptz;
      CREATE INDEX IF NOT EXISTS wildlife_jobs_client_created_idx
        ON wildlife_jobs (client_hash, created_at DESC);
      CREATE INDEX IF NOT EXISTS wildlife_jobs_created_idx
        ON wildlife_jobs (created_at DESC);
      CREATE TABLE IF NOT EXISTS wildlife_webhook_events (
        id uuid PRIMARY KEY,
        tier integer NOT NULL CHECK (tier BETWEEN 1 AND 3),
        label text NOT NULL,
        event_id text,
        confidence double precision,
        explanation text,
        start_time double precision,
        end_time double precision,
        stream_url text,
        video_id text,
        received_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS wildlife_webhook_events_event_id_idx
        ON wildlife_webhook_events (event_id) WHERE event_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS wildlife_webhook_events_received_idx
        ON wildlife_webhook_events (received_at DESC);
    `);
  })();
  return schemaReady;
}

function mapJob(row: Record<string, unknown>): WildlifeJob {
  return {
    id: String(row.id),
    sourceName: String(row.source_name || "WildWatch observation"),
    sourceUrl: String(row.source_url),
    lens: row.lens as AnalysisLens,
    status: row.status as JobStatus,
    stage: String(row.stage),
    progress: Number(row.progress),
    videoId: row.video_id ? String(row.video_id) : null,
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    streamUrl: row.stream_url ? String(row.stream_url) : null,
    evidenceUrl: row.evidence_url ? String(row.evidence_url) : null,
    sceneIndexId: row.scene_index_id ? String(row.scene_index_id) : null,
    observations: Array.isArray(row.observations) ? row.observations as WildlifeObservation[] : [],
    error: row.error ? String(row.error) : null,
    workflowRunId: row.workflow_run_id ? String(row.workflow_run_id) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    archivedAt: row.archived_at ? new Date(String(row.archived_at)).toISOString() : null,
  };
}

export async function findJob(id: string): Promise<WildlifeJob | null> {
  await ensureSchema();
  const { rows } = await pool.query("SELECT * FROM wildlife_jobs WHERE id = $1", [id]);
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function findIdempotentJob(clientHash: string, key: string): Promise<WildlifeJob | null> {
  await ensureSchema();
  const { rows } = await pool.query(
    "SELECT * FROM wildlife_jobs WHERE client_hash = $1 AND idempotency_key = $2",
    [clientHash, key],
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function findReusableAsset(sourceUrl: string, excludeJobId: string): Promise<WildlifeJob | null> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT * FROM wildlife_jobs
     WHERE source_url = $1 AND id <> $2 AND video_id IS NOT NULL
       AND stream_url IS NOT NULL AND duration_seconds IS NOT NULL
       AND created_at > now() - interval '30 days'
     ORDER BY updated_at DESC LIMIT 1`,
    [sourceUrl, excludeJobId],
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function createJob(input: {
  id: string;
  clientHash: string;
  idempotencyKey: string;
  sourceUrl: string;
  sourceName?: string;
  lens: AnalysisLens;
}): Promise<WildlifeJob> {
  await ensureSchema();
  const { rows } = await pool.query(
    `INSERT INTO wildlife_jobs
      (id, client_hash, idempotency_key, source_name, source_url, lens, status, stage, progress)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', 'Waiting for durable worker', 2)
     RETURNING *`,
    [input.id, input.clientHash, input.idempotencyKey, input.sourceName || "WildWatch observation", input.sourceUrl, input.lens],
  );
  return mapJob(rows[0]);
}

export async function listJobs(options: { limit?: number; completedOnly?: boolean; includeArchived?: boolean } = {}): Promise<WildlifeJob[]> {
  await ensureSchema();
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit || 50)));
  const conditions = [options.includeArchived ? "TRUE" : "archived_at IS NULL"];
  if (options.completedOnly) conditions.push("status = 'completed'");
  const { rows } = await pool.query(
    `SELECT * FROM wildlife_jobs WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(mapJob);
}

export async function findJobByVideoId(videoId: string): Promise<WildlifeJob | null> {
  await ensureSchema();
  const { rows } = await pool.query(
    "SELECT * FROM wildlife_jobs WHERE video_id = $1 ORDER BY updated_at DESC LIMIT 1",
    [videoId],
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function archiveJob(id: string): Promise<boolean> {
  await ensureSchema();
  const result = await pool.query(
    "UPDATE wildlife_jobs SET archived_at = COALESCE(archived_at, now()), updated_at = now() WHERE id = $1",
    [id],
  );
  return Boolean(result.rowCount);
}

export async function publicUsage(): Promise<{ jobsLast24h: number; jobsTotal: number; completedTotal: number; failedTotal: number }> {
  await ensureSchema();
  const { rows } = await pool.query(`
    SELECT
      count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS jobs_24h,
      count(*) AS jobs_total,
      count(*) FILTER (WHERE status = 'completed') AS completed_total,
      count(*) FILTER (WHERE status = 'failed') AS failed_total
    FROM wildlife_jobs
    WHERE archived_at IS NULL
  `);
  return {
    jobsLast24h: Number(rows[0].jobs_24h),
    jobsTotal: Number(rows[0].jobs_total),
    completedTotal: Number(rows[0].completed_total),
    failedTotal: Number(rows[0].failed_total),
  };
}

function mapWebhookEvent(row: Record<string, unknown>): PersistedWebhookEvent {
  return {
    id: String(row.id),
    tier: Number(row.tier),
    label: String(row.label),
    eventId: row.event_id ? String(row.event_id) : null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    explanation: row.explanation ? String(row.explanation) : null,
    startTime: row.start_time == null ? null : Number(row.start_time),
    endTime: row.end_time == null ? null : Number(row.end_time),
    streamUrl: row.stream_url ? String(row.stream_url) : null,
    videoId: row.video_id ? String(row.video_id) : null,
    receivedAt: new Date(String(row.received_at)).toISOString(),
  };
}

export async function persistWebhookEvent(input: Omit<PersistedWebhookEvent, "receivedAt">): Promise<PersistedWebhookEvent> {
  await ensureSchema();
  const { rows } = await pool.query(
    `INSERT INTO wildlife_webhook_events
      (id, tier, label, event_id, confidence, explanation, start_time, end_time, stream_url, video_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO UPDATE SET event_id = EXCLUDED.event_id
     RETURNING *`,
    [input.id, input.tier, input.label, input.eventId, input.confidence, input.explanation,
      input.startTime, input.endTime, input.streamUrl, input.videoId],
  );
  return mapWebhookEvent(rows[0]);
}

export async function listWebhookEvents(limit = 100): Promise<PersistedWebhookEvent[]> {
  await ensureSchema();
  const bounded = Math.max(1, Math.min(200, Math.floor(limit)));
  const { rows } = await pool.query(
    "SELECT * FROM wildlife_webhook_events ORDER BY received_at DESC LIMIT $1",
    [bounded],
  );
  return rows.map(mapWebhookEvent);
}

export async function updateJob(id: string, patch: Record<string, unknown>): Promise<void> {
  await ensureSchema();
  const allowed: Record<string, string> = {
    status: "status",
    stage: "stage",
    progress: "progress",
    videoId: "video_id",
    durationSeconds: "duration_seconds",
    streamUrl: "stream_url",
    evidenceUrl: "evidence_url",
    sceneIndexId: "scene_index_id",
    observations: "observations",
    error: "error",
    workflowRunId: "workflow_run_id",
  };
  const entries = Object.entries(patch).filter(([key]) => key in allowed);
  if (!entries.length) return;
  const sets = entries.map(([key], index) => `${allowed[key]} = $${index + 2}`);
  const values = entries.map(([key, value]) => key === "observations" ? JSON.stringify(value) : value);
  await pool.query(
    `UPDATE wildlife_jobs SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`,
    [id, ...values],
  );
}

export async function assertWithinRateLimits(clientHash: string): Promise<void> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE client_hash = $1) AS client_count,
       count(*) AS global_count
     FROM wildlife_jobs WHERE created_at > now() - interval '24 hours'`,
    [clientHash],
  );
  if (Number(rows[0].client_count) >= 2) throw new Error("CLIENT_RATE_LIMIT");
  if (Number(rows[0].global_count) >= 20) throw new Error("GLOBAL_RATE_LIMIT");
}
