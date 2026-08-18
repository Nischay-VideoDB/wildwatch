import { defineEventHandler, getRouterParam, setResponseStatus } from "nitro/h3";
import { z } from "zod";
import { findJob } from "../../../server/db.js";

export default defineEventHandler(async (event) => {
  const parsed = z.string().uuid().safeParse(getRouterParam(event, "id"));
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return { error: "Invalid job id" };
  }
  const job = await findJob(parsed.data);
  if (!job) {
    setResponseStatus(event, 404);
    return { error: "WildWatch observation not found" };
  }
  return { job };
});
