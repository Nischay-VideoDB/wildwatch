import { defineEventHandler } from "nitro/h3";
import { recentEvents } from "../../server/compat.js";

const encoder = new TextEncoder();

function sseEvent(item: Record<string, unknown>): Uint8Array {
  return encoder.encode(`id: ${String(item.id)}\nevent: observation\ndata: ${JSON.stringify(item)}\n\n`);
}

export default defineEventHandler((event) => {
  const lastEventId = event.req.headers.get("last-event-id") || "";
  let stopped = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emitted = new Set<string>();
      controller.enqueue(encoder.encode("retry: 2000\n: connected\n\n"));
      try {
        const initial = await recentEvents();
        const cursor = initial.findIndex((item) => String(item.id) === lastEventId);
        const replay = lastEventId && cursor >= 0 ? initial.slice(0, cursor) : initial.slice(0, 50);
        for (const item of [...replay].reverse()) {
          if (stopped) return;
          emitted.add(String(item.id));
          controller.enqueue(sseEvent(item));
        }
        for (let poll = 0; poll < 10 && !stopped; poll += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const latest = await recentEvents();
          const unseen = latest.filter((item) => !emitted.has(String(item.id))).reverse();
          for (const item of unseen) {
            emitted.add(String(item.id));
            controller.enqueue(sseEvent(item));
          }
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        }
      } catch {
        controller.enqueue(encoder.encode("event: error\ndata: {\"code\":\"EVENT_POLL_FAILED\",\"retryable\":true}\n\n"));
      } finally {
        if (!stopped) controller.close();
      }
    },
    cancel() { stopped = true; },
  });
  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
});
