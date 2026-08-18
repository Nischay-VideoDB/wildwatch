import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("public observations use durable storage, Vercel Workflow, VideoDB, and abuse controls", async () => {
  const [route, mediaRoute, workflow, db, security, ui] = await Promise.all([
    readFile(resolve(root, "routes/api/jobs.post.ts"), "utf8"),
    readFile(resolve(root, "routes/api/jobs/[id]/media/[...path].get.ts"), "utf8"),
    readFile(resolve(root, "workflows/analyze-wildlife.ts"), "utf8"),
    readFile(resolve(root, "server/db.ts"), "utf8"),
    readFile(resolve(root, "server/security.ts"), "utf8"),
    readFile(resolve(root, "live.js"), "utf8"),
  ]);
  assert.match(route, /start\(analyzeWildlife/);
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
