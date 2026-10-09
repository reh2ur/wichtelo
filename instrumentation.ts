import type { Instrumentation } from "next";
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }

  // Fail fast on a misconfigured deployment instead of at first request.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@/lib/env");
    validateEnv();
  }

  // Production only: pino already writes to stdout, so forwarding console.*
  // to it and ALSO to the original console printed every line twice. In dev
  // the pretty-terminal transport itself calls console.*, so patching would
  // recurse — leave console untouched there.
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { logger } = await import("@/lib/logger");
  const { serializeError } = await import("@/lib/serialize-error");

  console.error = (...args: unknown[]) => {
    const [first, ...rest] = args;
    if (first instanceof Error) {
      logger.withError(first).error(first.message, ...rest.map(String));
    } else if (typeof first === "object" && first !== null) {
      logger.error(serializeError(first).message, ...rest.map(String));
    } else {
      logger.error(String(first), ...rest.map(String));
    }
  };

  console.warn = (...args: unknown[]) => {
    logger.warn(String(args[0]), ...args.slice(1).map(String));
  };

  console.info = (...args: unknown[]) => {
    logger.info(String(args[0]), ...args.slice(1).map(String));
  };

  console.log = (...args: unknown[]) => {
    logger.info(String(args[0]), ...args.slice(1).map(String));
  };

  console.debug = (...args: unknown[]) => {
    logger.debug(String(args[0]), ...args.slice(1).map(String));
  };
}

// Structured log for every unhandled server error (render, route, action,
// proxy). Request path/headers are deliberately NOT logged: paths can carry
// bearer invite tokens (/einladung/<token>) and headers carry cookies.
// routePath is the file-system route (e.g. /einladung/[token]).
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  Sentry.captureRequestError(err, request, context);

  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@/lib/logger");
  const { serializeError } = await import("@/lib/serialize-error");

  logger
    .withMetadata({
      error: serializeError(err),
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
    })
    .error("request.unhandled_error");
};
