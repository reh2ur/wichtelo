"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { createIntlContext } from "@/lib/create-intl-context";

const { Provider: GroupDetailProvider, useT: useGroupDetailT } =
  createIntlContext("groupDetail");

export { GroupDetailProvider };

export function CopyInviteLinkClient({ inviteUrl }: { inviteUrl: string }) {
  const t = useGroupDetailT();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function handleCopy() {
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        const input = document.createElement("input");
        input.value = inviteUrl;
        document.body.appendChild(input);
        input.select();
        const didCopy = document.execCommand("copy");
        document.body.removeChild(input);
        if (!didCopy) throw new Error("Copy command failed");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setCopyFailed(true);
      }
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
        aria-label={copied ? t("inviteLink.copied") : t("inviteLink.copy")}
        data-invite-url={inviteUrl}
      >
        {copied ? (
          <>
            <CheckIcon size={14} />
            {t("inviteLink.copied")}
          </>
        ) : (
          <>
            <CopyIcon size={14} />
            {t("inviteLink.copy")}
          </>
        )}
      </Button>
      {copied && (
        <span role="status" className="sr-only">
          {t("inviteLink.copied")}
        </span>
      )}
      {copyFailed && (
        <div role="alert">
          <p>{t("inviteLink.copyFailed")}</p>
          <p className="break-all">{inviteUrl}</p>
        </div>
      )}
    </>
  );
}
