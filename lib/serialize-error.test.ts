import { describe, expect, it } from "vitest";
import { serializeError } from "./serialize-error";

describe("serializeError", () => {
  it("serializes Error instances with name", () => {
    const e = new TypeError("boom");
    expect(serializeError(e)).toEqual({ name: "TypeError", message: "boom" });
  });

  it("keeps code, status and digest when present", () => {
    const e = Object.assign(new Error("db"), {
      code: "23505",
      status: 409,
      digest: "abc",
    });
    expect(serializeError(e)).toEqual({
      name: "Error",
      message: "db",
      code: "23505",
      status: 409,
      digest: "abc",
    });
  });

  it("never yields [object Object] for plain objects", () => {
    const out = serializeError({ name: "validation_error", message: "bad" });
    expect(out).toEqual({ name: "validation_error", message: "bad" });
    expect(serializeError({ foo: 1 }).message).toBe('{"foo":1}');
  });

  it("handles strings, primitives and unserializable values", () => {
    expect(serializeError("oops")).toEqual({ message: "oops" });
    expect(serializeError(undefined)).toEqual({ message: "undefined" });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeError(circular).message).toBe("unserializable error");
  });

  it("omits stack", () => {
    expect(serializeError(new Error("x"))).not.toHaveProperty("stack");
  });
});
