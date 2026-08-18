import { defineEventHandler, readBody, setResponseStatus } from "nitro/h3";
import { createSource } from "../../server/compat.js";
import { compatibilityResponse } from "../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, async () => {
  const body = await readBody<Record<string, unknown>>(event);
  const source = await createSource(event.req, body || {});
  setResponseStatus(event, 202);
  return source;
}));
