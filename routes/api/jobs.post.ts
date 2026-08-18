import { defineEventHandler, readBody, setResponseStatus } from "nitro/h3";
import { z } from "zod";
import { publicJobError, startWildlifeJob } from "../../server/start-job.js";

const bodySchema = z.object({
  sourceUrl: z.string().min(1).max(2048),
  lens: z.enum(["wildlife", "habitat"]).default("wildlife"),
  idempotencyKey: z.string().min(8).max(120).regex(/^[A-Za-z0-9._:-]+$/).optional(),
});

export default defineEventHandler(async (event) => {
  try {
    const body = bodySchema.parse(await readBody(event));
    const result = await startWildlifeJob(event.req, body);
    setResponseStatus(event, 202);
    return result;
  } catch (error) {
    const failure = publicJobError(error);
    setResponseStatus(event, failure.status);
    return { error: failure.error };
  }
});
