import { defineEventHandler, readBody } from "nitro/h3";
import { buildDigest } from "../../../server/compat.js";
import { compatibilityResponse } from "../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, async () => buildDigest(
  await readBody<Record<string, unknown>>(event) || {},
)));
