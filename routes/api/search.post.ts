import { defineEventHandler, readBody } from "nitro/h3";
import { search } from "../../server/compat.js";
import { compatibilityResponse } from "../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, async () => search(
  await readBody<Record<string, unknown>>(event) || {},
)));
