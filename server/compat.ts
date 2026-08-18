import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { AnalysisLens, WildlifeJob, WildlifeObservation } from "./db.js";
import {
  archiveJob,
  findJob,
  findJobByVideoId,
  listJobs,
  listWebhookEvents,
  persistWebhookEvent,
  publicUsage,
} from "./db.js";
import { safeProviderError } from "./security.js";
import { startWildlifeJob } from "./start-job.js";

export class CompatibilityError extends Error {
  constructor(public status: number, message: string, public code = "COMPATIBILITY_ERROR") {
    super(message);
  }
}

export function sourceKind(sourceUrl: string): "youtube" | "hls" {
  const host = new URL(sourceUrl).hostname.toLowerCase();
  return host === "youtu.be" || host.endsWith("youtube.com") ? "youtube" : "hls";
}

function sourceStatus(job: WildlifeJob): string {
  if (job.status === "completed") return "ready";
  if (job.status === "failed") return "error";
  if (job.status === "queued") return "queued";
  return /index|review/i.test(job.stage) ? "indexing" : "ingesting";
}

export function jobToSource(job: WildlifeJob): Record<string, unknown> {
  return {
    id: job.id,
    kind: sourceKind(job.sourceUrl),
    input: job.sourceUrl,
    name: job.sourceName,
    status: sourceStatus(job),
    progress_pct: job.progress,
    stage_msg: job.stage,
    error: job.error,
    video_id: job.videoId,
    rtstream_id: null,
    indexes: job.sceneIndexId ? { visual: job.sceneIndexId } : {},
    credit_estimate_usd: null,
    created_at: Date.parse(job.createdAt) / 1000,
    updated_at: Date.parse(job.updatedAt) / 1000,
    runtime: "durable-vercel-workflow",
  };
}

export function jobToVideo(job: WildlifeJob): Record<string, unknown> {
  return {
    id: job.videoId,
    job_id: job.id,
    name: job.sourceName,
    length: job.durationSeconds,
    stream_url: job.streamUrl,
    evidence_url: job.evidenceUrl,
    thumbnail_url: null,
    status: job.status,
  };
}

export async function listSources(limit = 50): Promise<Record<string, unknown>[]> {
  return (await listJobs({ limit })).map(jobToSource);
}

export async function getSource(id: string): Promise<Record<string, unknown>> {
  const job = await findJob(id);
  if (!job || job.archivedAt) throw new CompatibilityError(404, "source not found", "SOURCE_NOT_FOUND");
  return jobToSource(job);
}

export async function createSource(request: Request, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const kind = String(body.kind || "").toLowerCase();
  if (["rtsp", "rtmp"].includes(kind)) {
    throw new CompatibilityError(
      501,
      "RTSP/RTMP sources require the original always-on MediaMTX bridge and cannot be owned by a request-scoped Vercel function. Use an HTTPS HLS/media URL here or run the documented bridge service.",
      "OPERATOR_BRIDGE_REQUIRED",
    );
  }
  if (!['youtube', 'hls'].includes(kind)) {
    throw new CompatibilityError(400, "kind must be youtube, hls, rtsp, or rtmp", "INVALID_SOURCE_KIND");
  }
  const sourceUrl = String(body.input || "");
  const sourceName = String(body.name || "WildWatch observation").trim().slice(0, 200);
  if (!sourceName) throw new CompatibilityError(400, "name is required", "INVALID_SOURCE_NAME");
  const lens: AnalysisLens = body.lens === "habitat" ? "habitat" : "wildlife";
  const headerKey = request.headers.get("idempotency-key") || undefined;
  const result = await startWildlifeJob(request, {
    sourceUrl,
    sourceName,
    lens,
    idempotencyKey: headerKey,
  });
  return { ...jobToSource(result.job), reused: result.reused };
}

export async function reconnectSource(request: Request, id: string): Promise<Record<string, unknown>> {
  const previous = await findJob(id);
  if (!previous) throw new CompatibilityError(404, "source not found", "SOURCE_NOT_FOUND");
  if (previous.archivedAt) {
    throw new CompatibilityError(
      410,
      "This source was archived. Submit its HTTPS media URL as a new observation if it should be analysed again.",
      "SOURCE_ARCHIVED",
    );
  }
  const result = await startWildlifeJob(request, {
    sourceUrl: previous.sourceUrl,
    sourceName: `${previous.sourceName} reconnect`,
    lens: previous.lens,
    idempotencyKey: request.headers.get("idempotency-key") ||
      `reconnect:${id}:${new Date().toISOString().slice(0, 13)}`,
  });
  return {
    ...jobToSource(result.job),
    previous_source_id: id,
    reused: result.reused,
    message: "A durable workflow is reconnecting this archived-media source; continuous RTSP cameras require the operator bridge.",
  };
}

export async function disconnectSource(id: string): Promise<never> {
  const source = await findJob(id);
  if (!source) throw new CompatibilityError(404, "source not found", "SOURCE_NOT_FOUND");
  if (source.archivedAt) {
    throw new CompatibilityError(410, "This source is already archived.", "SOURCE_ARCHIVED");
  }
  throw new CompatibilityError(
    409,
    "This is a completed or in-progress HTTPS media observation, not a continuously connected RTStream. Archive it with DELETE /api/sources/{id}; RTSP stop controls belong to the operator bridge.",
    "SOURCE_NOT_CONTINUOUS",
  );
}

export async function archiveSource(id: string): Promise<Record<string, unknown>> {
  const found = await findJob(id);
  if (!found || found.archivedAt) throw new CompatibilityError(404, "source not found", "SOURCE_NOT_FOUND");
  if (!await archiveJob(id)) throw new CompatibilityError(404, "source not found", "SOURCE_NOT_FOUND");
  return {
    id,
    status: "archived",
    provider_asset_retained: true,
    guidance: "The durable source row is hidden from operator listings. Its VideoDB asset and evidence remain available to existing job links.",
  };
}

export async function listVideos(limit = 50): Promise<Record<string, unknown>[]> {
  const jobs = await listJobs({ limit });
  const unique = new Map<string, WildlifeJob>();
  for (const job of jobs) if (job.videoId && !unique.has(job.videoId)) unique.set(job.videoId, job);
  return [...unique.values()].map(jobToVideo);
}

export async function ownedVideo(videoId: string): Promise<WildlifeJob> {
  const job = await findJobByVideoId(videoId);
  if (!job) throw new CompatibilityError(404, "video not found in WildWatch's persisted run assets", "VIDEO_NOT_FOUND");
  return job;
}

export async function videoIndexes(videoId: string): Promise<Record<string, unknown>[]> {
  const job = await ownedVideo(videoId);
  if (!job.sceneIndexId) return [];
  return [{
    scene_index_id: job.sceneIndexId,
    id: job.sceneIndexId,
    name: `wildwatch_public_${job.lens}_${job.id.slice(0, 8)}`,
    status: job.status === "completed" ? "ready" : job.status === "failed" ? "failed" : "processing",
    prompt_scope: job.lens,
  }];
}

export async function videoScenes(videoId: string, indexId: string, limit: number): Promise<{
  status: string;
  scenes: Record<string, unknown>[];
}> {
  const job = await ownedVideo(videoId);
  if (!job.sceneIndexId || job.sceneIndexId !== indexId) {
    throw new CompatibilityError(404, "scene index not found for this WildWatch asset", "INDEX_NOT_FOUND");
  }
  const status = job.status === "completed" ? "ready" : job.status === "failed" ? "failed" : "processing";
  const scenes = status === "ready" ? job.observations.slice(0, Math.max(1, Math.min(100, limit))).map((observation) => ({
    start: observation.start,
    end: observation.end,
    description: JSON.stringify({
      species: observation.species,
      count: observation.count,
      behavior: observation.behavior,
      environment: observation.environment,
      threat: observation.threat,
      confidence: observation.confidence,
      summary: observation.summary,
    }),
  })) : [];
  return { status, scenes };
}

function providerKey(): string {
  const apiKey = process.env.VIDEO_DB_API_KEY || process.env.VIDEODB_API_KEY;
  if (!apiKey) throw new CompatibilityError(503, "VideoDB is not configured", "PROVIDER_UNAVAILABLE");
  return apiKey;
}

function normalizeShot(shot: Record<string, unknown>, fallbackVideoId: string): Record<string, unknown> {
  return {
    video_id: shot.videoId || fallbackVideoId,
    video_name: shot.videoTitle || null,
    start: Number(shot.start || 0),
    end: Number(shot.end || 0),
    text: String(shot.text || ""),
    score: shot.searchScore == null ? null : Number(shot.searchScore),
    scene_index_id: shot.sceneIndexId || null,
    scene_index_name: shot.sceneIndexName || null,
  };
}

async function searchOne(job: WildlifeJob, query: string, limit: number): Promise<Record<string, unknown>[]> {
  if (!job.videoId || !job.sceneIndexId || job.status !== "completed") return [];
  const { connect } = await import("videodb");
  const collection = await connect({ apiKey: providerKey() }).getCollection();
  const video = await collection.getVideo(job.videoId);
  // indexVisuals() creates a legacy scene index. VideoDB SDK 0.3 keeps
  // legacySearch() specifically for these indexes; semanticSearch() targets
  // the newer generic index API and legitimately returns no legacy scenes.
  // Calling legacySearch explicitly also avoids the SDK's mixed-parameter
  // guard on search().
  const response = await video.legacySearch(query, "semantic", "scene", limit, 0.2);
  const normalizedResponse = response as unknown as {
    getShots?: () => unknown[];
    shots?: unknown[];
  };
  const shots = typeof normalizedResponse.getShots === "function"
    ? normalizedResponse.getShots()
    : normalizedResponse.shots;
  return (shots || [])
    .filter((shot: unknown) => {
      const shotIndex = (shot as Record<string, unknown>).sceneIndexId;
      return !shotIndex || shotIndex === job.sceneIndexId;
    })
    .slice(0, limit)
    .map((shot: unknown) => normalizeShot(shot as Record<string, unknown>, job.videoId!));
}

export async function search(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const query = String(body.query || "").trim();
  if (query.length < 2 || query.length > 300) {
    throw new CompatibilityError(400, "query must be between 2 and 300 characters", "INVALID_QUERY");
  }
  const scope = String(body.scope || "collection");
  const limit = Math.max(1, Math.min(20, Number(body.result_threshold || 10)));
  if (scope === "rtstream") {
    throw new CompatibilityError(501, "RTStream search requires the original always-on bridge deployment", "OPERATOR_BRIDGE_REQUIRED");
  }
  try {
    if (scope === "video") {
      const targetId = String(body.target_id || "");
      if (!targetId) throw new CompatibilityError(400, "target_id required for video scope", "TARGET_REQUIRED");
      const job = await ownedVideo(targetId);
      return { scope, video_id: targetId, shots: await searchOne(job, query, limit) };
    }
    if (scope !== "collection") throw new CompatibilityError(400, `unknown scope: ${scope}`, "INVALID_SCOPE");
    const jobs = await listJobs({ completedOnly: true, limit: 20 });
    const unique = [...new Map(jobs.filter((job) => job.videoId).map((job) => [job.videoId!, job])).values()].slice(0, 8);
    const settled = await Promise.allSettled(unique.map((job) => searchOne(job, query, limit)));
    const shots = settled.flatMap((item) => item.status === "fulfilled" ? item.value : [])
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, limit);
    return { scope, shots, videos_searched: unique.length };
  } catch (error) {
    if (error instanceof CompatibilityError) throw error;
    const message = safeProviderError(error);
    if (/no results/i.test(message)) return { scope, shots: [] };
    throw new CompatibilityError(502, message, "PROVIDER_SEARCH_FAILED");
  }
}

export async function videoClip(videoId: string, start: number, end: number): Promise<Record<string, unknown>> {
  const job = await ownedVideo(videoId);
  const duration = Number(job.durationSeconds || 0);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new CompatibilityError(400, "end must be greater than start and both must be valid seconds", "INVALID_CLIP_RANGE");
  }
  if (end - start > 600 || (duration && end > duration + 0.05)) {
    throw new CompatibilityError(400, "clip range exceeds the persisted video boundary", "INVALID_CLIP_RANGE");
  }
  try {
    const { connect } = await import("videodb");
    const collection = await connect({ apiKey: providerKey() }).getCollection();
    const video = await collection.getVideo(videoId);
    const streamUrl = await video.generateStream([[start, Math.min(end, duration || end)]]);
    return { video_id: videoId, start, end: Math.min(end, duration || end), stream_url: streamUrl };
  } catch (error) {
    throw new CompatibilityError(502, safeProviderError(error), "STREAM_GENERATION_FAILED");
  }
}

export async function reindexVideo(request: Request, videoId: string, kind: string): Promise<Record<string, unknown>> {
  if (!["video", "visual", "both"].includes(kind)) {
    throw new CompatibilityError(
      409,
      "This public workflow has no transcript-derived audio index. Use kind=video/visual/both for a fresh VideoDB wildlife index.",
      "AUDIO_INDEX_NOT_APPLICABLE",
    );
  }
  const previous = await ownedVideo(videoId);
  const headerKey = request.headers.get("idempotency-key") ||
    `reindex:${videoId}:${new Date().toISOString().slice(0, 13)}`;
  const result = await startWildlifeJob(request, {
    sourceUrl: previous.sourceUrl,
    sourceName: `${previous.sourceName} reindex`,
    lens: previous.lens,
    idempotencyKey: headerKey,
  });
  return {
    video_id: videoId,
    job_id: result.job.id,
    status: result.job.status,
    workflow_run_id: result.job.workflowRunId,
    reused: result.reused,
    message: "A durable workflow is creating a fresh visual index while reusing the existing VideoDB asset.",
  };
}

function observationPriority(observation: WildlifeObservation): number {
  return (observation.threat && observation.threat !== "none" ? 3 : 0) + observation.confidence;
}

export async function buildDigest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const topN = Math.max(1, Math.min(6, Number(body.top_n || 6)));
  const clipSeconds = Math.max(2, Math.min(8, Number(body.clip_seconds || 4)));
  const jobs = await listJobs({ completedOnly: true, limit: 30 });
  // Reconnect/reindex jobs can intentionally share a VideoDB asset. Only
  // include the newest persisted analysis for each asset so a digest never
  // repeats the same elephant scene three times.
  const newestByAsset = new Map<string, WildlifeJob>();
  for (const job of jobs) {
    const assetKey = job.videoId || job.id;
    if (!newestByAsset.has(assetKey)) newestByAsset.set(assetKey, job);
  }
  const uniqueJobs = [...newestByAsset.values()];
  const candidates = uniqueJobs.flatMap((job) => job.observations.map((observation) => ({ job, observation })))
    .sort((a, b) => observationPriority(b.observation) - observationPriority(a.observation)).slice(0, topN);
  if (!candidates.length) throw new CompatibilityError(409, "No completed observation evidence is available for a digest", "NO_DIGEST_EVIDENCE");
  try {
    const { connect, Timeline, VideoAsset } = await import("videodb");
    const connection = connect({ apiKey: providerKey() });
    const collection = await connection.getCollection();
    const timeline = new Timeline(connection);
    for (const { job, observation } of candidates) {
      if (!job.videoId || !job.durationSeconds) continue;
      const start = Math.max(0, observation.start);
      const end = Math.min(job.durationSeconds, Math.max(start + 0.5, Math.min(observation.end, start + clipSeconds)));
      if (end > start) timeline.addInline(new VideoAsset(job.videoId, { start, end }));
    }
    const streamUrl = await timeline.generateStream();
    const facts = candidates.map(({ job, observation }) => ({
      source: job.sourceName,
      species: observation.species,
      behavior: observation.behavior,
      environment: observation.environment,
      threat: observation.threat,
      confidence: observation.confidence,
    }));
    const summaryResult = await collection.generateText(
      `Write a concise client-facing wildlife monitoring digest using only these JSON observations. Distinguish unknowns, do not invent species or threats.\n${JSON.stringify(facts)}`,
      "basic",
      "text",
      { maxTokens: 260, temperature: 0.2 },
    );
    let summary = typeof summaryResult === "string" ? summaryResult : "";
    if (summaryResult && typeof summaryResult === "object") {
      const generated = summaryResult as Record<string, unknown>;
      summary = String(generated.output || generated.text || generated.content || JSON.stringify(generated));
    } else if (summary.startsWith("{")) {
      try {
        const generated = JSON.parse(summary) as Record<string, unknown>;
        summary = String(generated.output || generated.text || generated.content || summary);
      } catch { /* keep provider text verbatim */ }
    }
    return {
      player_url: streamUrl,
      stream_url: streamUrl,
      summary,
      n_clips: candidates.length,
      n_events: candidates.length,
      telegram_sent: false,
      telegram_status: body.notify_telegram === false ? "not-requested" : "optional-unconfigured",
      durable: true,
    };
  } catch (error) {
    if (error instanceof CompatibilityError) throw error;
    throw new CompatibilityError(502, safeProviderError(error), "DIGEST_BUILD_FAILED");
  }
}

export async function stats(): Promise<Record<string, unknown>> {
  const [usage, jobs, webhookEvents] = await Promise.all([publicUsage(), listJobs({ limit: 100 }), listWebhookEvents(100)]);
  const observations = jobs.reduce((total, job) => total + job.observations.length, 0);
  const threats = jobs.reduce((total, job) => total + job.observations.filter((item) => item.threat !== "none").length, 0);
  return {
    total: observations + webhookEvents.length,
    by_tier: {
      "1": webhookEvents.filter((event) => event.tier === 1).length,
      "2": webhookEvents.filter((event) => event.tier === 2).length,
      "3": webhookEvents.filter((event) => event.tier === 3).length + threats,
    },
    observations,
    webhook_events: webhookEvents.length,
    jobs: usage,
    storage: "azure-postgres",
  };
}

export async function usage(): Promise<Record<string, unknown>> {
  const value = await publicUsage();
  return {
    scope: "wildwatch-public-demo",
    ...value,
    limits: { perBrowser24h: 2, global24h: 20, maxMediaSeconds: 600 },
    account_billing_hidden: true,
    guidance: "Shared VideoDB invoices and account-wide assets are intentionally not exposed by the public deployment.",
  };
}

export async function recentEvents(): Promise<Record<string, unknown>[]> {
  const [jobs, webhookEvents] = await Promise.all([listJobs({ completedOnly: true, limit: 25 }), listWebhookEvents(100)]);
  const observations = jobs.flatMap((job) => job.observations.map((observation, index) => ({
    id: `${job.id}:${index}`,
    type: "observation",
    received_at: job.updatedAt,
    tier: observation.threat !== "none" ? 3 : 1,
    label: observation.species,
    confidence: observation.confidence,
    explanation: observation.summary,
    start_time: observation.start,
    end_time: observation.end,
    stream_url: job.evidenceUrl || job.streamUrl,
    video_id: job.videoId,
    job_id: job.id,
  })));
  return [...webhookEvents.map((event) => ({
    id: event.id,
    type: "webhook",
    received_at: event.receivedAt,
    tier: event.tier,
    label: event.label,
    confidence: event.confidence,
    explanation: event.explanation,
    start_time: event.startTime,
    end_time: event.endTime,
    stream_url: event.streamUrl,
    video_id: event.videoId,
  })), ...observations].sort((a, b) => String(b.received_at).localeCompare(String(a.received_at))).slice(0, 150);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(createHash("sha256").update(a).digest("hex"));
  const right = Buffer.from(createHash("sha256").update(b).digest("hex"));
  return timingSafeEqual(left, right);
}

export async function receiveWebhook(request: Request, tier: number, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const configured = process.env.WILDWATCH_WEBHOOK_SECRET;
  if (!configured) throw new CompatibilityError(
    501,
    "Webhook delivery is disabled on this public deployment. Configure WILDWATCH_WEBHOOK_SECRET on an operator-owned deployment before registering VideoDB RTStream alerts.",
    "WEBHOOK_NOT_CONFIGURED",
  );
  if (!safeEqual(request.headers.get("x-wildwatch-secret") || "", configured)) {
    throw new CompatibilityError(401, "invalid webhook secret", "INVALID_WEBHOOK_SECRET");
  }
  const label = String(body.label || "").trim().slice(0, 256);
  if (!label) throw new CompatibilityError(400, "label is required", "INVALID_WEBHOOK");
  const confidence = body.confidence == null ? null : Number(body.confidence);
  const event = await persistWebhookEvent({
    id: randomUUID(),
    tier,
    label,
    eventId: body.event_id ? String(body.event_id).slice(0, 256) : null,
    confidence: confidence != null && Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    explanation: body.explanation ? String(body.explanation).slice(0, 8000) : null,
    startTime: body.start_time == null ? null : Number(body.start_time),
    endTime: body.end_time == null ? null : Number(body.end_time),
    streamUrl: body.stream_url ? String(body.stream_url).slice(0, 4096) : null,
    videoId: body.video_id ? String(body.video_id).slice(0, 128) : null,
  });
  return { status: "received", event, telegram: "optional-unconfigured" };
}
