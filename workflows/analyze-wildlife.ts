import { FatalError, sleep } from "workflow";
import type { Video } from "videodb";
import type { AnalysisLens, WildlifeObservation } from "../server/db.js";

const MAX_DURATION_SECONDS = 10 * 60;

const WILDLIFE_PROMPT = `Act as a cautious wildlife observer. Analyze only visible evidence in this video window. Return exactly one compact JSON object and no markdown:
{"species":"common name or unknown","count":1,"behavior":"specific visible action or none","environment":"water, vegetation, weather, or habitat evidence","threat":"visible human intrusion, injury, fire, or none","confidence":0.0,"summary":"specific visible evidence"}
Do not infer rare species, poaching, injury, or danger from ambiguous frames. Use unknown and none when evidence is insufficient.`;

const HABITAT_PROMPT = `Act as a cautious habitat monitor. Analyze only visible evidence in this video window. Return exactly one compact JSON object and no markdown:
{"species":"common name or unknown","count":null,"behavior":"specific visible action or none","environment":"specific water, vegetation, weather, camera, or habitat condition","threat":"visible fire, human intrusion, injured animal, camera failure, or none","confidence":0.0,"summary":"specific visible evidence"}
Never infer drought, poaching, or ecological harm from a single ambiguous view. Use unknown and none when evidence is insufficient.`;

type Uploaded = { videoId: string; durationSeconds: number; streamUrl: string };
type IndexRecord = { start: number; end: number; description: string };
type IndexSnapshot = { status: string; records: IndexRecord[] };

async function markRunning(jobId: string): Promise<void> {
  "use step";
  const { findJob, updateJob } = await import("../server/db.js");
  const job = await findJob(jobId);
  if (!job) throw new FatalError("WildWatch job no longer exists");
  if (job.status === "completed") return;
  await updateJob(jobId, { status: "running", stage: "Uploading media to VideoDB", progress: 8, error: null });
}

async function uploadMedia(jobId: string, sourceUrl: string): Promise<Uploaded> {
  "use step";
  const { connect } = await import("videodb");
  const { findJob, findReusableAsset, updateJob } = await import("../server/db.js");
  const job = await findJob(jobId);
  if (job?.videoId && job.streamUrl && job.durationSeconds) {
    return { videoId: job.videoId, streamUrl: job.streamUrl, durationSeconds: job.durationSeconds };
  }
  const reusable = await findReusableAsset(sourceUrl, jobId);
  if (reusable?.videoId && reusable.streamUrl && reusable.durationSeconds) {
    await updateJob(jobId, {
      videoId: reusable.videoId,
      durationSeconds: reusable.durationSeconds,
      streamUrl: reusable.streamUrl,
      stage: "Reusing the durable VideoDB asset; creating a fresh observer index",
      progress: 28,
    });
    return { videoId: reusable.videoId, streamUrl: reusable.streamUrl, durationSeconds: reusable.durationSeconds };
  }
  const apiKey = process.env.VIDEO_DB_API_KEY || process.env.VIDEODB_API_KEY;
  if (!apiKey) throw new FatalError("VIDEO_DB_API_KEY is not configured");
  const uploaded = await connect({ apiKey }).uploadURL("default", {
    url: sourceUrl,
    name: `WildWatch public observation ${jobId.slice(0, 8)}`,
    description: "Public, rate-limited WildWatch demo run",
  });
  if (!uploaded || !("generateStream" in uploaded)) throw new Error("VideoDB did not return a video asset");
  const video = uploaded as Video;
  const durationSeconds = Number(video.length || 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("VideoDB could not determine media duration");
  if (durationSeconds > MAX_DURATION_SECONDS) {
    throw new FatalError("This public demo accepts videos up to 10 minutes to control processing cost");
  }
  const streamUrl = await video.generateStream();
  await updateJob(jobId, {
    videoId: video.id,
    durationSeconds,
    streamUrl,
    stage: "Creating a VideoDB wildlife index",
    progress: 28,
  });
  return { videoId: video.id, durationSeconds, streamUrl };
}

async function startVisualIndex(jobId: string, videoId: string, lens: AnalysisLens): Promise<string> {
  "use step";
  const { connect } = await import("videodb");
  const { findJob, updateJob } = await import("../server/db.js");
  const job = await findJob(jobId);
  if (job?.sceneIndexId) return job.sceneIndexId;
  const apiKey = process.env.VIDEO_DB_API_KEY || process.env.VIDEODB_API_KEY;
  if (!apiKey) throw new FatalError("VIDEO_DB_API_KEY is not configured");
  const coll = await connect({ apiKey }).getCollection();
  const video = await coll.getVideo(videoId);
  let sceneIndexId: string | undefined;
  try {
    sceneIndexId = await video.indexVisuals({
      batchConfig: { type: "time", value: 6, frameCount: 3, selectFrames: ["first", "middle", "last"] },
      prompt: lens === "wildlife" ? WILDLIFE_PROMPT : HABITAT_PROMPT,
      modelName: "basic",
      name: `wildwatch_public_${lens}_${jobId.slice(0, 8)}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const existing = message.match(/Scene index with id\s+([a-f0-9]+)/i)?.[1];
    if (!existing) throw error;
    sceneIndexId = existing;
  }
  if (!sceneIndexId) throw new Error("VideoDB did not return a scene index id");
  await updateJob(jobId, { sceneIndexId, stage: "VideoDB is reviewing visible wildlife evidence", progress: 38 });
  return sceneIndexId;
}

async function readIndex(videoId: string, sceneIndexId: string): Promise<IndexSnapshot> {
  "use step";
  const { connect } = await import("videodb");
  const apiKey = process.env.VIDEO_DB_API_KEY || process.env.VIDEODB_API_KEY;
  if (!apiKey) throw new FatalError("VIDEO_DB_API_KEY is not configured");
  const coll = await connect({ apiKey }).getCollection();
  const video = await coll.getVideo(videoId);
  const indexes = await video.listSceneIndex();
  const current = indexes.find((item) => item.sceneIndexId === sceneIndexId);
  let records: IndexRecord[] = [];
  try { records = await video.getSceneIndex(sceneIndexId); } catch { /* indexing is still in progress */ }
  return { status: current?.status || (records.length ? "ready" : "processing"), records };
}

function parseRecord(record: IndexRecord): WildlifeObservation | null {
  const text = String(record.description || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  let parsed: Record<string, unknown> = {};
  if (match) {
    try { parsed = JSON.parse(match[0]); } catch { parsed = {}; }
  }
  const species = String(parsed.species || "unknown").replace(/\s+/g, " ").trim().slice(0, 80) || "unknown";
  const behavior = String(parsed.behavior || "none").replace(/\s+/g, " ").trim().slice(0, 160) || "none";
  const environment = String(parsed.environment || "unknown").replace(/\s+/g, " ").trim().slice(0, 180) || "unknown";
  const threat = String(parsed.threat || "none").replace(/\s+/g, " ").trim().slice(0, 100) || "none";
  const summary = String(parsed.summary || text).replace(/\s+/g, " ").trim().slice(0, 320);
  if (!summary) return null;
  const rawCount = parsed.count == null ? null : Number(parsed.count);
  const count = rawCount != null && Number.isFinite(rawCount) ? Math.max(0, Math.min(1000, Math.round(rawCount))) : null;
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5)));
  return {
    start: Math.max(0, Number(record.start || 0)),
    end: Math.max(Number(record.start || 0) + 0.5, Number(record.end || 0)),
    species,
    count,
    behavior,
    environment,
    threat,
    confidence,
    summary,
  };
}

async function finishAnalysis(jobId: string, videoId: string, durationSeconds: number, streamUrl: string, records: IndexRecord[]): Promise<void> {
  "use step";
  const { connect } = await import("videodb");
  const { updateJob } = await import("../server/db.js");
  const observations = records.map(parseRecord).filter((item): item is WildlifeObservation => Boolean(item));
  const apiKey = process.env.VIDEO_DB_API_KEY || process.env.VIDEODB_API_KEY;
  if (!apiKey) throw new FatalError("VIDEO_DB_API_KEY is not configured");
  const coll = await connect({ apiKey }).getCollection();
  const video = await coll.getVideo(videoId);
  const chosen = observations
    .map((item) => ({ start: Math.max(0, item.start), end: Math.min(durationSeconds, item.end) }))
    .filter((item) => item.end - item.start >= 0.5)
    .slice(0, 6);
  const evidenceUrl = chosen.length
    ? await video.generateStream(chosen.map((item) => [item.start, item.end] as [number, number]))
    : streamUrl;
  await updateJob(jobId, {
    status: "completed",
    stage: observations.length ? "Observer review ready" : "Review ready — no visible observation extracted",
    progress: 100,
    observations,
    evidenceUrl,
    error: null,
  });
}

async function failAnalysis(jobId: string, message: string): Promise<void> {
  "use step";
  const { updateJob } = await import("../server/db.js");
  await updateJob(jobId, { status: "failed", stage: "Analysis failed", progress: 100, error: message });
}

export async function analyzeWildlife(jobId: string, sourceUrl: string, lens: AnalysisLens): Promise<{ jobId: string }> {
  "use workflow";
  try {
    await markRunning(jobId);
    const uploaded = await uploadMedia(jobId, sourceUrl);
    const sceneIndexId = await startVisualIndex(jobId, uploaded.videoId, lens);
    let stableReads = 0;
    let lastCount = -1;
    let snapshot: IndexSnapshot = { status: "processing", records: [] };
    for (let attempt = 0; attempt < 90; attempt += 1) {
      snapshot = await readIndex(uploaded.videoId, sceneIndexId);
      const ready = ["ready", "done", "completed", "indexed"].includes(snapshot.status.toLowerCase());
      stableReads = snapshot.records.length > 0 && snapshot.records.length === lastCount ? stableReads + 1 : 0;
      lastCount = snapshot.records.length;
      if (ready || stableReads >= 2) break;
      await sleep("10s");
    }
    if (!snapshot.records.length) throw new Error("VideoDB scene indexing did not finish within 15 minutes");
    await finishAnalysis(jobId, uploaded.videoId, uploaded.durationSeconds, uploaded.streamUrl, snapshot.records);
    return { jobId };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = /api[_ -]?key|token|authorization|credential/i.test(raw)
      ? "The media provider rejected this run. Please try again later."
      : raw.replace(/https?:\/\/[^\s]+/g, "the submitted media URL").slice(0, 300);
    await failAnalysis(jobId, message);
    return { jobId };
  }
}
