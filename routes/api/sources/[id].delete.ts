import { defineEventHandler } from "nitro/h3";
import { archiveSource } from "../../../server/compat.js";
import { compatibilityResponse, uuidRouteParam } from "../../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, () => archiveSource(uuidRouteParam(event, "id"))));
