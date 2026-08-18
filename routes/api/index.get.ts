import { defineEventHandler } from "nitro/h3";

export default defineEventHandler(() => ({
  name: "WildWatch compatibility API",
  status: "ok",
  routes: {
    live_workflow: "/api/jobs",
    sources: "/api/sources",
    videos: "/api/videos",
    search: "/api/search",
    digest: "/api/digest/build",
    events: "/events/stream",
    health: "/health",
  },
  operator_boundary: "Continuous RTSP/RTMP controls require the original MediaMTX operator bridge.",
}));
