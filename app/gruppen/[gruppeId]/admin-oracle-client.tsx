"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { lookupAssignment, type OracleState } from "./actions";
import { createIntlContext } from "@/lib/create-intl-context";

const INPUT_CLASS =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

export interface Member {
  id: string;
  name_snapshot: string;
}

const { Provider: OracleProvider, useT: useOracleT } =
  createIntlContext("oracle");

export { OracleProvider };

export function AdminOracleClient({
  slug,
  members,
}: {
  slug: string;
  members: Member[];
}) {
  const t = useOracleT();

  const [confirming, setConfirming] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [submittedId, setSubmittedId] = useState("");
  const [state, action, pending] = useActionState<OracleState, FormData>(
    lookupAssignment,
    { status: "idle" },
  );

  const selectedMember = members.find((m) => m.id === selectedId);

  const revealed =
    state.status === "success" &&
    state.giverId === selectedId &&
    submittedId === selectedId;

  const phase = revealed ? "revealed" : confirming ? "confirming" : "idle";

  const errorMsg =
    state.status === "error"
      ? state.error === "not_admin"
        ? t("errors.notAdmin")
        : state.error === "not_found"
          ? t("errors.notFound")
          : t("errors.generic")
      : null;

  return (
    <section className="mb-4">
      <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
        {t("title")}
      </h2>

      {phase === "idle" && (
        <div className="border-border bg-card flex items-end gap-3 rounded-lg border px-4 py-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <label htmlFor="oracle-select" className="text-sm font-bold">
              {t("selectPrompt")}
            </label>
            <select
              id="oracle-select"
              className={INPUT_CLASS}
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="" disabled>
                —
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name_snapshot}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!selectedId}
            onClick={() => setConfirming(true)}
          >
            {t("lookup")}
          </Button>
        </div>
      )}

      {phase === "confirming" && selectedMember && (
        <div className="border-border bg-muted/30 space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">{t("confirm.title")}</p>
          <p className="text-muted-foreground text-sm">
            {t("confirm.message", { name: selectedMember.name_snapshot })}
          </p>
          {errorMsg && <p className="text-destructive text-sm">{errorMsg}</p>}
          <form
            action={action}
            onSubmit={() => setSubmittedId(selectedId)}
            className="flex gap-2"
          >
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="membershipId" value={selectedId} />
            <Button type="submit" disabled={pending}>
              {pending ? "…" : t("confirm.button")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirming(false);
                setSelectedId("");
                setSubmittedId("");
              }}
              disabled={pending}
            >
              {t("confirm.cancel")}
            </Button>
          </form>
        </div>
      )}

      {phase === "revealed" && state.status === "success" && selectedMember && (
        <div className="border-border bg-card space-y-3 rounded-lg border px-4 py-4">
          <p className="text-sm font-medium">
            {t("result", {
              giver: selectedMember.name_snapshot,
              receiver: state.receiverName,
            })}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirming(false);
              setSelectedId("");
              setSubmittedId("");
            }}
          >
            {t("reset")}
          </Button>
        </div>
      )}
    </section>
  );
}
