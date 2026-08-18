import { defineEventHandler, getQuery } from "nitro/h3";
import { videoClip } from "../../../../server/compat.js";
import { compatibilityResponse, routeParam } from "../../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, () => {
  const query = getQuery(event);
  return videoClip(routeParam(event, "videoId"), Number(query.start), Number(query.end));
}));
