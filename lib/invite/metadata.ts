import type { Metadata } from "next";

type T = (key: string, values?: Record<string, string>) => string;

/**
 * Link-preview metadata for an invite page. Group name only — never
 * budget/note/member data (invite page exposure rule). Unknown token or lookup
 * failure → generic preview, no error. Drawn group → neutral, no join CTA.
 */
export function inviteMetadata(
  group: { name: string; state: "open" | "drawn" } | null,
  t: T,
): Metadata {
  let title: string;
  let description: string;
  if (!group) {
    title = t("meta.genericTitle");
    description = t("meta.genericDescription");
  } else if (group.state === "drawn") {
    title = t("meta.drawnTitle", { groupName: group.name });
    description = t("meta.drawnDescription");
  } else {
    title = t("meta.title", { groupName: group.name });
    description = t("meta.description");
  }
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}
