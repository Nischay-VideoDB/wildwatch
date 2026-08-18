import { defineEventHandler } from "nitro/h3";
import { videoIndexes } from "../../../../server/compat.js";
import { compatibilityResponse, routeParam } from "../../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, async () => {
  const videoId = routeParam(event, "videoId");
  return { video_id: videoId, indexes: await videoIndexes(videoId) };
}));
