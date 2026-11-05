import { healthResponse } from "../schemas.ts";
import type { App } from "./types.ts";

export function healthRoutes(app: App): void {
  app.get("/health", { schema: { response: { 200: healthResponse } } }, () => ({
    status: "ok" as const,
  }));
}
