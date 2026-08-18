import { defineEventHandler } from "nitro/h3";
import { compatibilityResponse, unsupported } from "../../../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, () => unsupported(
  409,
  "DURABLE_EVIDENCE_IMMUTABLE",
  "The public demo does not delete VideoDB indexes that back durable client evidence. Reindex to create a fresh run or use the authenticated operator service for destructive maintenance.",
)));
