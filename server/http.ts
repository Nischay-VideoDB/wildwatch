import { getRouterParam, setResponseStatus, type H3Event } from "nitro/h3";
import { CompatibilityError } from "./compat.js";

export type TypedErrorBody = {
  error: {
    code: string;
    message: string;
    status: number;
  };
};

export function typedError(status: number, code: string, message: string): TypedErrorBody {
  return { error: { code, message, status } };
}

export async function compatibilityResponse<T>(event: H3Event, run: () => Promise<T> | T): Promise<T | TypedErrorBody> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CompatibilityError) {
      setResponseStatus(event, error.status);
      return typedError(error.status, error.code, error.message);
    }
    const message = error instanceof Error ? error.message : "Unexpected compatibility route failure";
    if (message === "CLIENT_RATE_LIMIT") {
      setResponseStatus(event, 429);
      return typedError(429, "CLIENT_RATE_LIMIT", "This browser has reached the public limit of 2 runs per 24 hours.");
    }
    if (message === "GLOBAL_RATE_LIMIT") {
      setResponseStatus(event, 429);
      return typedError(429, "GLOBAL_RATE_LIMIT", "Today's public processing capacity is full. Prepared examples remain available.");
    }
    if (/valid HTTPS|Only HTTPS|URLs containing credentials|Private network URLs|media host must resolve|Idempotency-Key/i.test(message)) {
      setResponseStatus(event, 400);
      return typedError(400, "INVALID_PUBLIC_MEDIA_REQUEST", message.slice(0, 300));
    }
    setResponseStatus(event, 500);
    return typedError(500, "INTERNAL_ERROR", "The compatibility route failed without exposing provider credentials or submitted media URLs.");
  }
}

export function routeParam(event: H3Event, name: string): string {
  return String(getRouterParam(event, name) || "").trim();
}

export function uuidRouteParam(event: H3Event, name: string): string {
  const value = routeParam(event, name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new CompatibilityError(400, `Invalid ${name}`, "INVALID_IDENTIFIER");
  }
  return value;
}

export function unsupported(status: 409 | 410 | 501, code: string, message: string): never {
  throw new CompatibilityError(status, message, code);
}
