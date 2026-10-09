import { describe, expect, it } from "vitest";
import { getOperator } from "./operator";

describe("getOperator", () => {
  it("reads operator fields from env", () => {
    expect(
      getOperator({
        OPERATOR_NAME: "Erika Mustermann",
        OPERATOR_ADDRESS_LINE1: "Musterstr. 1",
        OPERATOR_ADDRESS_LINE2: "12345 Musterstadt",
        OPERATOR_CONTACT_EMAIL: "a@example.com",
      }),
    ).toEqual({
      name: "Erika Mustermann",
      addressLine1: "Musterstr. 1",
      addressLine2: "12345 Musterstadt",
      contactEmail: "a@example.com",
    });
  });

  it("falls back to placeholders when unset", () => {
    expect(getOperator({}).name).toBe("[OPERATOR_NAME]");
  });
});
