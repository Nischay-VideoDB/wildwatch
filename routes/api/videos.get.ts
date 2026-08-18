import { defineEventHandler, getQuery } from "nitro/h3";
import { listVideos } from "../../server/compat.js";
import { compatibilityResponse } from "../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, async () => ({
  videos: await listVideos(Number(getQuery(event).limit || 50)),
})));
