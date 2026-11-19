import { z } from "zod";
import type { ApiDeps } from "../app.ts";
import { projectItem } from "@friday/contracts";
import type { App } from "./types.ts";

export function projectRoutes(app: App, deps: ApiDeps): void {
  app.get("/projects", { schema: { response: { 200: z.array(projectItem) } } }, () =>
    deps.projects.list().map((id) => ({ id })),
  );
}
