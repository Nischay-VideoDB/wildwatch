import { defineEventHandler, setResponseStatus } from "nitro/h3";
import { routeParam, typedError } from "../../server/http.js";

export default defineEventHandler((event) => {
  setResponseStatus(event, 404);
  return typedError(404, "EVENT_ROUTE_NOT_FOUND", `Unknown WildWatch event route: /events/${routeParam(event, "path")}`);
});
