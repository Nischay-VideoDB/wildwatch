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
        UNIQUE (client_hash, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS wildlife_jobs_client_created_idx
        ON wildlife_jobs (client_hash, created_at DESC);
      CREATE INDEX IF NOT EXISTS wildlife_jobs_created_idx
        ON wildlife_jobs (created_at DESC);
    `);
  })();
  return schemaReady;
}

function mapJob(row: Record<string, unknown>): WildlifeJob {
  return {
    id: String(row.id),
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
  lens: AnalysisLens;
}): Promise<WildlifeJob> {
  await ensureSchema();
  const { rows } = await pool.query(
    `INSERT INTO wildlife_jobs
      (id, client_hash, idempotency_key, source_url, lens, status, stage, progress)
     VALUES ($1, $2, $3, $4, $5, 'queued', 'Waiting for durable worker', 2)
     RETURNING *`,
    [input.id, input.clientHash, input.idempotencyKey, input.sourceUrl, input.lens],
  );
  return mapJob(rows[0]);
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
