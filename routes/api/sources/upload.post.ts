import { defineEventHandler } from "nitro/h3";
import { compatibilityResponse, unsupported } from "../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, () => unsupported(
  501,
  "DIRECT_UPLOAD_UNAVAILABLE",
  "Multipart uploads exceed the safe public serverless request contract. Provide a public HTTPS media URL to POST /api/sources or use the original operator service for local files.",
)));
