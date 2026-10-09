import { LogLayer } from "loglayer";
import { PinoTransport } from "@loglayer/transport-pino";
import { SimplePrettyTerminalTransport } from "@loglayer/transport-simple-pretty-terminal";
import pino from "pino";

function createLogger() {
  if (process.env.NODE_ENV === "production") {
    const pinoLogger = pino({ level: "info" });
    return new LogLayer({
      transport: new PinoTransport({ logger: pinoLogger }),
    });
  }
  return new LogLayer({
    transport: new SimplePrettyTerminalTransport({ runtime: "node" }),
  });
}

export const logger = createLogger();
