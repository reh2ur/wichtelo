import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import messages from "@/messages/de.json";

describe.each(["draw", "redraw"] as const)("%s.emailFailure plural", (ns) => {
  const t = createTranslator({ locale: "de", messages, namespace: ns });

  it("uses singular verb for one failure", () => {
    expect(t("emailFailure", { failed: 1, total: 3 })).toMatch(
      /^1 von 3 E-Mails konnte nicht zugestellt/,
    );
  });

  it("uses plural verb for two failures", () => {
    expect(t("emailFailure", { failed: 2, total: 3 })).toMatch(
      /^2 von 3 E-Mails konnten nicht zugestellt/,
    );
  });

  it("singular noun when total is one", () => {
    expect(t("emailFailure", { failed: 1, total: 1 })).toMatch(
      /^1 von 1 E-Mail konnte nicht/,
    );
  });
});
