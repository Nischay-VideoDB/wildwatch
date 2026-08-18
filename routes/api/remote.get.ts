import { defineEventHandler } from "nitro/h3";
import { compatibilityResponse, unsupported } from "../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, () => unsupported(
  501,
  "OPERATOR_INVENTORY_UNAVAILABLE",
  "Account-wide RTStream and sandbox inventory belongs to the original authenticated operator service and is not exposed by the public Vercel demo.",
)));
