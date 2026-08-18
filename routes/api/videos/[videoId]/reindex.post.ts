import { defineEventHandler, getQuery, setResponseStatus } from "nitro/h3";
import { reindexVideo } from "../../../../server/compat.js";
import { compatibilityResponse, routeParam } from "../../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, async () => {
  const result = await reindexVideo(event.req, routeParam(event, "videoId"), String(getQuery(event).kind || "both"));
  setResponseStatus(event, 202);
  return result;
}));
