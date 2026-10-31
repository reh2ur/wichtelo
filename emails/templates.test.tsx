import { readdirSync } from "node:fs";
import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { siteUrl } from "./components/theme";
import { AccountDeletionEmail } from "./account-deletion";
import { AccountDeletionAdminNoticeEmail } from "./account-deletion-admin-notice";
import { AccountDeletionConfirmedEmail } from "./account-deletion-confirmed";
import { AccountInactivityWarningEmail } from "./account-inactivity-warning";
import { DrawAssignmentEmail } from "./draw-assignment";
import { GroupDeletedEmail } from "./group-deleted";
import { ParticipantJoinedEmail } from "./participant-joined";
import { ParticipantLeftAdminNoticeEmail } from "./participant-left-admin-notice";
import { ParticipantLeftConfirmationEmail } from "./participant-left-confirmation";
import { ParticipantRemovedEmail } from "./participant-removed";

// Hostile user-controlled strings (group + participant names, admin contact).
const EVIL = `<script>alert("x")</script> & Co`;
const EVIL_ESCAPED = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;";

const confirmUrl = "https://wichtelo.example/konto/delete/confirm?token=abc";

const templates: Array<{
  file: string;
  element: () => ReactElement;
  /** Absolute CTA link the mail must carry, if it has a button. */
  cta?: string;
  /** User-controlled strings that must show up (escaped). */
  userStrings: boolean;
}> = [
  {
    file: "account-deletion",
    element: () => <AccountDeletionEmail confirmUrl={confirmUrl} />,
    cta: confirmUrl,
    userStrings: false,
  },
  {
    file: "account-deletion-admin-notice",
    element: () => (
      <AccountDeletionAdminNoticeEmail
        groupName={EVIL}
        participantName={EVIL}
        postDraw={false}
      />
    ),
    userStrings: true,
  },
  {
    file: "account-deletion-confirmed",
    element: () => <AccountDeletionConfirmedEmail name={EVIL} />,
    userStrings: true,
  },
  {
    file: "account-inactivity-warning",
    element: () => (
      <AccountInactivityWarningEmail
        name={EVIL}
        deletionDate="30. November 2026"
      />
    ),
    cta: `${siteUrl}/anmelden`,
    userStrings: true,
  },
  {
    file: "draw-assignment",
    element: () => (
      <DrawAssignmentEmail
        groupName={EVIL}
        groupSlug="familie-muster"
        year={2026}
        giverName={EVIL}
        receiverDisplayName={EVIL}
        adminName={EVIL}
        adminEmail="admin@example.com"
        isRedraw={false}
      />
    ),
    cta: `${siteUrl}/gruppen/familie-muster`,
    userStrings: true,
  },
  {
    file: "group-deleted",
    element: () => (
      <GroupDeletedEmail
        groupName={EVIL}
        year={2026}
        recipientName={EVIL}
        adminName={EVIL}
        adminEmail="admin@example.com"
      />
    ),
    userStrings: true,
  },
  {
    file: "participant-joined",
    element: () => (
      <ParticipantJoinedEmail groupName={EVIL} participantName={EVIL} />
    ),
    userStrings: true,
  },
  {
    file: "participant-left-admin-notice",
    element: () => (
      <ParticipantLeftAdminNoticeEmail
        groupName={EVIL}
        participantName={EVIL}
      />
    ),
    userStrings: true,
  },
  {
    file: "participant-left-confirmation",
    element: () => <ParticipantLeftConfirmationEmail groupName={EVIL} />,
    userStrings: true,
  },
  {
    file: "participant-removed",
    element: () => (
      <ParticipantRemovedEmail
        groupName={EVIL}
        adminName={EVIL}
        adminEmail="admin@example.com"
      />
    ),
    userStrings: true,
  },
];

describe("all email templates", () => {
  it("covers every template file in emails/", () => {
    const files = readdirSync(__dirname)
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .map((f) => f.replace(/\.tsx$/, ""))
      .sort();
    expect(templates.map((t) => t.file).sort()).toEqual(files);
  });

  describe.each(templates)("$file", ({ element, cta, userStrings }) => {
    it("renders non-empty German HTML", async () => {
      const html = await render(element());
      expect(html.length).toBeGreaterThan(500);
      expect(html).toContain('lang="de"');
      expect(html).toContain("Wichtelo");
    });

    it("carries absolute Impressum + Datenschutz footer links", async () => {
      const html = await render(element());
      expect(html).toContain(`href="${siteUrl}/impressum"`);
      expect(html).toContain(`href="${siteUrl}/datenschutz"`);
      expect(siteUrl).toMatch(/^https?:\/\//);
    });

    it("links the CTA with an absolute URL", async () => {
      if (!cta) return;
      const html = await render(element());
      expect(cta).toMatch(/^https?:\/\//);
      expect(html).toContain(`href="${cta}"`);
    });

    it("escapes user-supplied strings", async () => {
      if (!userStrings) return;
      const html = await render(element());
      expect(html).not.toContain("<script");
      expect(html).toContain(EVIL_ESCAPED);
      expect(html).toContain("&amp; Co");
    });
  });
});
