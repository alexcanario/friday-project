import { existsSync } from "node:fs";
import { join } from "node:path";
import swagger from "@fastify/swagger";
import type {
  ApprovalStore,
  BreakerStateRepository,
  EventStore,
  IssueRepository,
  LedgerRepository,
  ProjectEnabledRepository,
  RunLedgerReader,
  RunRepository,
} from "@friday/application";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { approvalRoutes } from "./routes/approvals.ts";
import { healthRoutes } from "./routes/health.ts";
import { issueRoutes } from "./routes/issues.ts";
import { ledgerRoutes } from "./routes/ledger.ts";
import { runReviewRoutes } from "./routes/run-review.ts";
import { runRoutes } from "./routes/runs.ts";
import { statusRoutes } from "./routes/status.ts";

export interface ApiDeps {
  events: EventStore;
  issues: IssueRepository;
  runs: RunRepository;
  ledger: LedgerRepository;
  runLedger: RunLedgerReader;
  approvals: ApprovalStore;
  breaker: BreakerStateRepository;
  enabled: ProjectEnabledRepository;
  now: () => number;
}

export interface BuildAppOptions {
  /** Folder with the built panel (`index.html` and `assets/`); nothing is served when it has no `index.html`. */
  webRoot?: string;
}

export async function buildApp(
  deps: ApiDeps,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: { info: { title: "Friday API", version: "0.0.0" } },
    transform: jsonSchemaTransform,
  });
  healthRoutes(app);
  issueRoutes(app, deps);
  runRoutes(app, deps);
  runReviewRoutes(app, deps);
  ledgerRoutes(app, deps);
  approvalRoutes(app, deps);
  statusRoutes(app, deps);
  app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());
  if (options.webRoot !== undefined && existsSync(join(options.webRoot, "index.html"))) {
    await app.register(fastifyStatic, { root: options.webRoot, schemaHide: true });
  }
  await app.ready();
  return app;
}
