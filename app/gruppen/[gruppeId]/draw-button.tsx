import { getMessages } from "next-intl/server";
import { DrawProvider, DrawButtonClient } from "./draw-button-client";

export async function DrawButton({ slug }: { slug: string }) {
  const messages = await getMessages();
  return (
    <DrawProvider messages={{ draw: messages.draw }}>
      <DrawButtonClient slug={slug} />
    </DrawProvider>
  );
}
