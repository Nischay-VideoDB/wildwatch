import { defineEventHandler } from "nitro/h3";
import { compatibilityResponse, unsupported } from "../../../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, () => unsupported(
  501,
  "OPERATOR_BRIDGE_REQUIRED",
  "RTStream scene polling requires the original always-on operator bridge. Use /api/videos/{id}/scenes/{indexId} for durable public observations.",
)));
