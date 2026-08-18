import { defineEventHandler, setResponseStatus } from "nitro/h3";
import { reconnectSource } from "../../../../server/compat.js";
import { compatibilityResponse, uuidRouteParam } from "../../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, async () => {
  const result = await reconnectSource(event.req, uuidRouteParam(event, "id"));
  setResponseStatus(event, 202);
  return result;
}));
