import http from "node:http";
import https from "node:https";
import type { Transport } from "./fetch";

/**
 * Real HTTP transport. Connects to the already validated `address` (custom
 * `lookup` pins it) while keeping Host/SNI = hostname, so a second DNS answer
 * (DNS rebinding) can never redirect the connection to an internal host.
 * No cookies/credentials, no compression (no decompression bombs), no agent
 * reuse across requests.
 */
export const nodeTransport: Transport = ({
  url,
  address,
  family,
  headers,
  signal,
  insecureTls,
}) =>
  new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        headers,
        agent: false,
        rejectUnauthorized: !insecureTls,
        signal,
        timeout: 5000,
        lookup: (_host, options, callback) => {
          if (options && (options as { all?: boolean }).all) {
            (
              callback as (
                e: null,
                a: { address: string; family: number }[],
              ) => void
            )(null, [{ address, family }]);
          } else {
            callback(null, address, family);
          }
        },
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: res,
          destroy: () => res.destroy(),
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
