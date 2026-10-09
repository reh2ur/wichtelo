import { getMessages } from "next-intl/server";
import { RedrawProvider, RedrawButtonClient } from "./redraw-button-client";

export async function RedrawButton({ slug }: { slug: string }) {
  const messages = await getMessages();
  return (
    <RedrawProvider messages={{ redraw: messages.redraw }}>
      <RedrawButtonClient slug={slug} />
    </RedrawProvider>
  );
}
