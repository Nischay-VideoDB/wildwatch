import { defineEventHandler } from "nitro/h3";
import { disconnectSource } from "../../../../server/compat.js";
import { compatibilityResponse, uuidRouteParam } from "../../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, () => disconnectSource(uuidRouteParam(event, "id"))));
