"use client";

import { useEffect, useRef, useState } from "react";
import { CopyIcon, CheckIcon } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createIntlContext } from "@/lib/create-intl-context";

const { Provider: GroupDetailProvider, useT: useGroupDetailT } =
  createIntlContext("groupDetail");

export { GroupDetailProvider };

type CopyStatus = "idle" | "copied" | "failed";

function legacyCopy(text: string): boolean {
  const input = document.createElement("input");
  input.value = text;
  document.body.appendChild(input);
  input.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(input);
  }
}

export function CopyInviteLinkClient({ inviteUrl }: { inviteUrl: string }) {
  const t = useGroupDetailT();
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function report(next: CopyStatus) {
    if (timer.current) clearTimeout(timer.current);
    setStatus(next);
    if (next === "copied") {
      timer.current = setTimeout(() => setStatus("idle"), 2000);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      report("copied");
    } catch {
      report(legacyCopy(inviteUrl) ? "copied" : "failed");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          readOnly
          value={inviteUrl}
          aria-label={t("inviteLink.urlLabel")}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 basis-48"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          data-invite-url={inviteUrl}
        >
          {status === "copied" ? (
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
      </div>
      <p
        role={status === "failed" ? "alert" : "status"}
        className={
          status === "failed"
            ? "text-danger-text text-sm"
            : "text-success-text sr-only"
        }
      >
        {status === "copied"
          ? t("inviteLink.copied")
          : status === "failed"
            ? t("inviteLink.failed")
            : ""}
      </p>
    </div>
  );
}
