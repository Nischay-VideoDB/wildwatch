import { defineEventHandler, getRouterParam } from "nitro/h3";
import { z } from "zod";
import { findJob } from "../../../../../server/db.js";

const jobIdSchema = z.string().uuid();
const mediaPathSchema = z.string().regex(
  /^(?:master\.m3u8|(?:audio|video)\/[A-Za-z0-9._/-]+\.m3u8|segment\/[a-f0-9]{32,128}\.ts)$/,
);

function upstreamFor(baseUrl: string, mediaPath: string): URL {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.hostname !== "play.videodb.io") {
    throw new Error("Unsupported VideoDB playback origin");
  }
  const match = base.pathname.match(/^\/v1\/([A-Za-z0-9-]+)\.m3u8$/);
  if (!match) throw new Error("Unsupported VideoDB playback URL");
  if (mediaPath === "master.m3u8") return base;
  if (mediaPath.startsWith("segment/")) {
    return new URL(`/v1/${mediaPath}`, base.origin);
  }
  return new URL(`/v1/${match[1]}/${mediaPath}`, base.origin);
}

function rewritePlaylist(body: string, jobId: string, upstream: URL): string {
  const streamMatch = upstream.pathname.match(/^\/v1\/([A-Za-z0-9-]+)/);
  const streamId = streamMatch?.[1];
  const localBase = `/api/jobs/${encodeURIComponent(jobId)}/media`;
  let rewritten = body.replace(
    /https:\/\/play\.videodb\.io\/v1\/segment\/([a-f0-9]{32,128}\.ts)/g,
    `${localBase}/segment/$1`,
  );
  if (streamId) {
    rewritten = rewritten.replaceAll(
      `https://play.videodb.io/v1/${streamId}/`,
      `${localBase}/`,
    );
  }
  return rewritten;
}

export default defineEventHandler(async (event) => {
  const jobId = jobIdSchema.safeParse(getRouterParam(event, "id"));
  const mediaPath = mediaPathSchema.safeParse(getRouterParam(event, "path"));
  if (!jobId.success || !mediaPath.success) {
    return new Response("Invalid playback request", { status: 400 });
  }

  const job = await findJob(jobId.data);
  const playbackUrl = job?.evidenceUrl || job?.streamUrl;
  if (!job || job.status !== "completed" || !playbackUrl) {
    return new Response("Playback is not available", { status: 404 });
  }

  let upstream: URL;
  try {
    upstream = upstreamFor(playbackUrl, mediaPath.data);
  } catch {
    return new Response("Playback is not available", { status: 404 });
  }

  const response = await fetch(upstream, {
    headers: { "user-agent": "WildWatch/1.0 VideoDB playback relay" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return new Response("VideoDB playback unavailable", { status: 502 });

  const cacheControl = mediaPath.data.endsWith(".ts")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300, stale-while-revalidate=3600";
  if (mediaPath.data.endsWith(".m3u8")) {
    const body = rewritePlaylist(await response.text(), jobId.data, upstream);
    return new Response(body, {
      headers: {
        "cache-control": cacheControl,
        "content-type": "application/vnd.apple.mpegurl",
        "x-content-type-options": "nosniff",
      },
    });
  }

  return new Response(await response.arrayBuffer(), {
    headers: {
      "cache-control": cacheControl,
      "content-type": response.headers.get("content-type") || "video/mp2t",
      "x-content-type-options": "nosniff",
    },
  });
});
