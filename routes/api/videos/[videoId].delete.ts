import { defineEventHandler } from "nitro/h3";
import { compatibilityResponse, unsupported } from "../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, () => unsupported(
  409,
  "DURABLE_ASSET_IMMUTABLE",
  "The public demo does not delete VideoDB assets referenced by durable observations. Archive the WildWatch source or use the authenticated operator service for destructive maintenance.",
)));
