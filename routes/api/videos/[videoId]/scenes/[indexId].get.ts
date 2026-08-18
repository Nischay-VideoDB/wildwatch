import { defineEventHandler, getQuery } from "nitro/h3";
import { videoScenes } from "../../../../../server/compat.js";
import { compatibilityResponse, routeParam } from "../../../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, async () => {
  const videoId = routeParam(event, "videoId");
  const indexId = routeParam(event, "indexId");
  const result = await videoScenes(videoId, indexId, Number(getQuery(event).limit || 20));
  return { video_id: videoId, index_id: indexId, ...result };
}));
