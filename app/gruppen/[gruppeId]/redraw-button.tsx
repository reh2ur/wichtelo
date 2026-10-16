import { getMessages } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
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
  const warning = await fetchDrawMailWarning(supabase, groupId);
  return (
    <RedrawProvider messages={{ redraw: messages.redraw }}>
      <RedrawButtonClient slug={slug} warning={warning} />
    </RedrawProvider>
  );
}
