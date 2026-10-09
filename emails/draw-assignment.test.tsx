import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { DrawAssignmentEmail } from "./draw-assignment";

const props = {
  groupName: "Familie Muster",
  groupSlug: "familie-muster",
  year: 2026,
  giverName: "Max",
  receiverDisplayName: "Zacharias",
  adminName: "Anna Admin",
  adminEmail: "anna@example.com",
};

describe("DrawAssignmentEmail", () => {
  it.each([false, true])(
    "preheader does not reveal the recipient (isRedraw=%s)",
    async (isRedraw) => {
      const html = await render(
        <DrawAssignmentEmail {...props} isRedraw={isRedraw} />,
      );
      const preheader = html.match(
        /<div[^>]*display:none[^>]*>([\s\S]*?)<\/div>/,
      )?.[1];
      expect(preheader).toBeDefined();
      expect(preheader).toContain("Familie Muster");
      expect(preheader).not.toContain("Zacharias");
    },
  );

  it("shows the recipient in the body with beschenkst wording", async () => {
    const html = await render(
      <DrawAssignmentEmail {...props} isRedraw={false} />,
    );
    expect(html).toContain("Du beschenkst:");
    expect(html).toContain("Zacharias");
  });

  it("links back to the group page without leaking the recipient", async () => {
    const html = await render(
      <DrawAssignmentEmail {...props} isRedraw={false} />,
    );
    expect(html).toContain("/gruppen/familie-muster");
    expect(html).toContain("Zur Gruppe");
  });
});
