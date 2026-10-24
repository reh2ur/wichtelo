import { getMessages } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { groupNeedsRedraw } from "@/lib/group-reads";
import { fetchDrawMailWarning } from "@/lib/draw-mail-status";
import { RedrawProvider, RedrawButtonClient } from "./redraw-button-client";

export async function RedrawButton({
  slug,
  groupId,
}: {
  slug: string;
  groupId: string;
}) {
  const [messages, supabase] = await Promise.all([
    getMessages(),
    createClient(),
  ]);
  // Persisted server-side: survives tab close and device switch.
  const [warning, needsRedraw] = await Promise.all([
    fetchDrawMailWarning(supabase, groupId),
    // Broken gift chain after an admin removed a member from a drawn group.
    groupNeedsRedraw(createAdminClient(), groupId),
  ]);
  return (
    <RedrawProvider messages={{ redraw: messages.redraw }}>
      <RedrawButtonClient
        slug={slug}
        warning={warning}
        needsRedraw={needsRedraw}
      />
    </RedrawProvider>
  );
}
