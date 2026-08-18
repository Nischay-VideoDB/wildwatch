import { defineEventHandler } from "nitro/h3";
import { compatibilityResponse, unsupported } from "../../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, () => unsupported(
  501,
  "OPERATOR_BRIDGE_REQUIRED",
  "RTStream indexes require the original always-on MediaMTX/VideoDB operator bridge; the public Vercel deployment analyses bounded HTTPS media with durable workflows.",
)));
