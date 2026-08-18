import { defineEventHandler, readBody } from "nitro/h3";
import { CompatibilityError, receiveWebhook } from "../../server/compat.js";
import { compatibilityResponse, routeParam } from "../../server/http.js";

export default defineEventHandler((event) => compatibilityResponse(event, async () => {
  const tier = Number(routeParam(event, "tier"));
  if (!Number.isInteger(tier) || tier < 1 || tier > 3) {
    throw new CompatibilityError(400, "tier must be 1, 2, or 3", "INVALID_ALERT_TIER");
  }
  const body = await readBody<Record<string, unknown>>(event);
  return receiveWebhook(event.req, tier, body || {});
}));
