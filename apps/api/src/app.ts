import swagger from "@fastify/swagger";
import type {
  EventStore,
  IssueRepository,
  LedgerRepository,
  RunRepository,
} from "@friday/application";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { healthRoutes } from "./routes/health.ts";
import { issueRoutes } from "./routes/issues.ts";
import { ledgerRoutes } from "./routes/ledger.ts";
import { runRoutes } from "./routes/runs.ts";

export interface ApiDeps {
  events: EventStore;
  issues: IssueRepository;
  runs: RunRepository;
  ledger: LedgerRepository;
}

export async function buildApp(deps: ApiDeps): Promise<FastifyInstance> {
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
  ledgerRoutes(app, deps);
  app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());
  await app.ready();
  return app;
}
