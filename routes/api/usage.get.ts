import { defineEventHandler } from "nitro/h3";
import { usage } from "../../server/compat.js";
import { compatibilityResponse } from "../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, usage));
