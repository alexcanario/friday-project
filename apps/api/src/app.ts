import { existsSync } from "node:fs";
import { join } from "node:path";
import swagger from "@fastify/swagger";
import type {
  ApprovalStore,
  BreakerStateRepository,
  EventStore,
  GitHubPort,
  IssueRepository,
  LedgerRepository,
  ProjectEnabledRepository,
  ProjectListReader,
  RunLedgerReader,
  RunRepository,
  UnitOfWork,
} from "@friday/application";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { registerAttemptLimit, type AttemptLimit } from "./attempt-limit.ts";
import { registerCors } from "./cors.ts";
import { registerErrorHandler } from "./error-handler.ts";
import { registerHostCheck } from "./host-check.ts";
import { isPanelTokenValid } from "./panel-token.ts";
import { approvalRoutes } from "./routes/approvals.ts";
import { eventsRoutes } from "./routes/events.ts";
import { healthRoutes } from "./routes/health.ts";
import { issueRoutes } from "./routes/issues.ts";
import { ledgerRoutes } from "./routes/ledger.ts";
import { projectRoutes } from "./routes/projects.ts";
import { runReviewRoutes } from "./routes/run-review.ts";
import { runRoutes } from "./routes/runs.ts";
import { statusRoutes } from "./routes/status.ts";
import type { App } from "./routes/types.ts";

export interface ApiDeps {
  events: EventStore;
  issues: IssueRepository;
  runs: RunRepository;
  ledger: LedgerRepository;
  runLedger: RunLedgerReader;
  approvals: ApprovalStore;
  breaker: BreakerStateRepository;
  enabled: ProjectEnabledRepository;
  projects: ProjectListReader;
  /** Secret of the `x-friday-token` header (D108); undefined or empty rejects every write. */
  panelToken: string | undefined;
  unitOfWork: UnitOfWork;
  github: Pick<GitHubPort, "squashMerge">;
  readPrHead: (pr: number) => Promise<string>;
  now: () => number;
  /** Receives one JSON line per logged error (500s and GitHub failures); nothing is logged when absent. */
  log?: (message: string) => void;
  /** Poll interval of `GET /events/stream` in ms (default 1000). */
  ssePollMs?: number;
}

export interface BuildAppOptions {
  /** Folder with the built panel (`index.html` and `assets/`); nothing is served when it has no `index.html`. */
  webRoot?: string;
  /** Origins that receive CORS headers (exact match; `*` and `null` never match). */
  allowedOrigins?: readonly string[];
  /** `Host` values accepted (lowercase); when omitted no host check is registered. Runs before CORS. */
  allowedHosts?: () => readonly string[];
  /** Refusal counter (401 and 403): at the limit every request but `/health` gets 429. Off when omitted. */
  attemptLimit?: AttemptLimit;
  /** Called for every route registered, so a test can walk all of them. */
  onRoute?: (route: { method: string | string[]; url: string }) => void;
}

/** Registers every API route in an encapsulated plugin guarded by the panel token (health stays outside). */
async function registerApiRoutes(app: App, deps: ApiDeps): Promise<void> {
  await app.register(async (api) => {
    api.addHook("onRequest", async (req, reply) => {
      if (deps.panelToken === undefined || deps.panelToken === "") return;
      if (!isPanelTokenValid(req.headers["x-friday-token"], deps.panelToken)) {
        return reply.code(401).send({ message: "Token do painel inválido." });
      }
    });
    const typed = api.withTypeProvider<ZodTypeProvider>() as unknown as App;
    issueRoutes(typed, deps);
    runRoutes(typed, deps);
    runReviewRoutes(typed, deps);
    ledgerRoutes(typed, deps);
    approvalRoutes(typed, deps);
    projectRoutes(typed, deps);
    statusRoutes(typed, deps);
    eventsRoutes(typed, deps);
    typed.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());
  });
}

export async function buildApp(
  deps: ApiDeps,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.addHook("onRoute", (r) => options.onRoute?.({ method: r.method, url: r.url }));
  if (options.allowedHosts !== undefined) registerHostCheck(app, options.allowedHosts);
  registerCors(app, options.allowedOrigins ?? []);
  if (options.attemptLimit !== undefined) {
    registerAttemptLimit(app, options.attemptLimit, deps.now, deps.log);
  }
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: { info: { title: "Friday API", version: "0.0.0" } },
    transform: jsonSchemaTransform,
  });
  registerErrorHandler(app, deps.log);
  healthRoutes(app);
  await registerApiRoutes(app, deps);
  if (options.webRoot !== undefined && existsSync(join(options.webRoot, "index.html"))) {
    await app.register(fastifyStatic, { root: options.webRoot, schemaHide: true });
  }
  await app.ready();
  return app;
}
