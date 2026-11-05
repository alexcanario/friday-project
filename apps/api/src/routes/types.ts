import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

export type App = FastifyInstance<
  import("node:http").Server,
  import("node:http").IncomingMessage,
  import("node:http").ServerResponse,
  import("fastify").FastifyBaseLogger,
  ZodTypeProvider
>;
