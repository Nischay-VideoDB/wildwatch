import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("public observations use durable storage, Vercel Workflow, VideoDB, and abuse controls", async () => {
  const [route, startJob, mediaRoute, workflow, db, security, ui] = await Promise.all([
    readFile(resolve(root, "routes/api/jobs.post.ts"), "utf8"),
    readFile(resolve(root, "server/start-job.ts"), "utf8"),
    readFile(resolve(root, "routes/api/jobs/[id]/media/[...path].get.ts"), "utf8"),
    readFile(resolve(root, "workflows/analyze-wildlife.ts"), "utf8"),
    readFile(resolve(root, "server/db.ts"), "utf8"),
    readFile(resolve(root, "server/security.ts"), "utf8"),
    readFile(resolve(root, "live.js"), "utf8"),
  ]);
  assert.match(route, /startWildlifeJob/);
  assert.match(startJob, /start\(analyzeWildlife/);
  assert.match(workflow, /"use workflow"/);
  assert.match(workflow, /uploadURL/);
  assert.match(workflow, /indexVisuals/);
  assert.match(workflow, /generateStream/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS wildlife_jobs/);
  assert.match(db, /UNIQUE \(client_hash, idempotency_key\)/);
  assert.match(db, /CLIENT_RATE_LIMIT/);
  assert.match(security, /Only HTTPS media URLs are accepted/);
  assert.match(security, /isPrivateAddress/);
  assert.match(ui, /localStorage\.setItem/);
  assert.match(ui, /setInterval/);
  assert.match(ui, /Hls\.isSupported/);
  assert.match(ui, /MANIFEST_PARSED/);
  assert.match(ui, /media\/master\.m3u8/);
  assert.match(mediaRoute, /play\.videodb\.io/);
  assert.match(mediaRoute, /status !== "completed"/);
  assert.match(mediaRoute, /mediaPathSchema/);
});

test("the original WildWatch HTTP surface has explicit server routes and typed boundaries", async () => {
  const routeFiles = [
    "routes/health.get.ts",
    "routes/api/index.get.ts",
    "routes/api/stats.get.ts",
    "routes/api/remote.get.ts",
    "routes/events.get.ts",
    "routes/events/stream.get.ts",
    "routes/webhook/[tier].post.ts",
    "routes/api/sources.get.ts",
    "routes/api/sources.post.ts",
    "routes/api/sources/upload.post.ts",
    "routes/api/sources/[id].get.ts",
    "routes/api/sources/[id].delete.ts",
    "routes/api/sources/[id]/disconnect.post.ts",
    "routes/api/sources/[id]/reconnect.post.ts",
    "routes/api/videos.get.ts",
    "routes/api/videos/[videoId]/indexes.get.ts",
    "routes/api/videos/[videoId]/indexes/[indexId].delete.ts",
    "routes/api/videos/[videoId]/scenes/[indexId].get.ts",
    "routes/api/videos/[videoId]/reindex.post.ts",
    "routes/api/videos/[videoId].delete.ts",
    "routes/api/videos/[videoId]/clip.get.ts",
    "routes/api/rtstreams/[rtId]/indexes.get.ts",
    "routes/api/rtstreams/[rtId]/scenes/[indexId].get.ts",
    "routes/api/usage.get.ts",
    "routes/api/search.post.ts",
    "routes/api/digest/build.post.ts",
    "routes/api/[...path].ts",
    "routes/events/[...path].ts",
  ];
  const files = await Promise.all(routeFiles.map((file) => readFile(resolve(root, file), "utf8")));
  assert.equal(files.length, routeFiles.length);

  const [compat, http, sse] = await Promise.all([
    readFile(resolve(root, "server/compat.ts"), "utf8"),
    readFile(resolve(root, "server/http.ts"), "utf8"),
    readFile(resolve(root, "routes/events/stream.get.ts"), "utf8"),
  ]);
  assert.match(compat, /OPERATOR_BRIDGE_REQUIRED/);
  assert.match(compat, /SOURCE_ARCHIVED/);
  assert.match(compat, /WEBHOOK_NOT_CONFIGURED/);
  assert.match(http, /status: number/);
  assert.match(http, /CompatibilityError/);
  assert.match(sse, /last-event-id/);
  assert.match(sse, /recentEvents/);
  assert.match(sse, /text\/event-stream/);
});
