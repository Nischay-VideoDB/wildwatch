import { defineEventHandler } from "nitro/h3";

export default defineEventHandler(() => ({
  status: "ok",
  stream: "/events/stream",
  transport: "bounded-sse-replay-and-poll",
  reconnect: true,
}));
