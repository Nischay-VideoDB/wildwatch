import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { analyzeWildlife } from "../workflows/analyze-wildlife.js";
import {
  assertWithinRateLimits,
  createJob,
  findIdempotentJob,
  updateJob,
  type AnalysisLens,
  type WildlifeJob,
} from "./db.js";
import { clientHash, defaultIdempotencyKey, validatePublicMediaUrl } from "./security.js";

export async function startWildlifeJob(request: Request, input: {
  sourceUrl: string;
  sourceName?: string;
  lens: AnalysisLens;
  idempotencyKey?: string;
}): Promise<{ job: WildlifeJob; reused: boolean }> {
  const sourceUrl = await validatePublicMediaUrl(input.sourceUrl);
  const hash = clientHash(request);
  const key = input.idempotencyKey || defaultIdempotencyKey(sourceUrl, input.lens);
  if (key.length < 8 || key.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new Error("Idempotency-Key must be 8-120 letters, numbers, dots, underscores, colons, or hyphens");
  }
  const existing = await findIdempotentJob(hash, key);
  if (existing) return { job: existing, reused: true };
  await assertWithinRateLimits(hash);
  const job = await createJob({
    id: randomUUID(),
    clientHash: hash,
    idempotencyKey: key,
    sourceName: input.sourceName,
    sourceUrl,
    lens: input.lens,
  });
  const run = await start(analyzeWildlife, [job.id, sourceUrl, input.lens]);
  await updateJob(job.id, { workflowRunId: run.runId });
  return { job: { ...job, workflowRunId: run.runId }, reused: false };
}

export function publicJobError(error: unknown): { status: number; error: string } {
  const message = error instanceof Error ? error.message : "Unable to start observation";
  if (message === "CLIENT_RATE_LIMIT") {
    return { status: 429, error: "This browser has reached the public limit of 2 runs per 24 hours." };
  }
  if (message === "GLOBAL_RATE_LIMIT") {
    return { status: 429, error: "Today's public processing capacity is full. Prepared examples remain available." };
  }
  return { status: 400, error: message.slice(0, 300) };
}
