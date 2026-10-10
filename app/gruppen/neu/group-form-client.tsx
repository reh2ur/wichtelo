"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { createGroup, type CreateGroupState } from "./actions";
import { createIntlContext } from "@/lib/create-intl-context";

const INPUT_CLASS =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

const TEXTAREA_CLASS =
  "flex min-h-[80px] w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

const { Provider: CreateGroupProvider, useT: useCreateGroupT } =
  createIntlContext("createGroup");

export { CreateGroupProvider };

function errorMessage(
  state: CreateGroupState,
  t: ReturnType<typeof useCreateGroupT>,
): string | null {
  if (state.status !== "error") return null;
  switch (state.error) {
    case "missing_name":
      return t("errors.missingName");
    case "missing_year":
      return t("errors.missingYear");
    case "profile_required":
      return t("errors.profileRequired");
    case "too_long":
      return t("errors.tooLong", { max: state.max ?? 0 });
    case "rate_limited":
      return t("errors.rateLimited");
    default:
      return t("errors.generic");
  }
}

export function GroupFormClient({
  hasProfile,
  currentYear,
}: {
  hasProfile: boolean;
  currentYear: number;
}) {
  const t = useCreateGroupT();
  const [state, action, pending] = useActionState<CreateGroupState, FormData>(
    createGroup,
    { status: "idle" },
  );

  const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i);
  const error = errorMessage(state, t);
  const v = state.status === "error" ? state.values : undefined;

  return (
    <form action={action} className="space-y-5">
      {!hasProfile && (
        <section className="border-border space-y-4 rounded-lg border border-dashed p-4">
          <div>
            <p className="text-sm font-semibold">{t("profile.section")}</p>
            <p className="text-muted-foreground text-sm">{t("profile.hint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="firstName" className="text-sm font-bold">
                {t("profile.firstNameLabel")}
              </label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                placeholder={t("profile.firstNamePlaceholder")}
                autoComplete="given-name"
                defaultValue={v?.firstName}
                maxLength={50}
                required
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="lastName" className="text-sm font-bold">
                {t("profile.lastNameLabel")}
              </label>
              <input
                id="lastName"
                name="lastName"
                type="text"
                placeholder={t("profile.lastNamePlaceholder")}
                autoComplete="family-name"
                defaultValue={v?.lastName}
                maxLength={50}
                required
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </section>
      )}

      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-bold">
          {t("nameLabel")}
        </label>
        <input
          id="name"
          name="name"
          type="text"
          placeholder={t("namePlaceholder")}
          defaultValue={v?.name}
          maxLength={100}
          required
          className={INPUT_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="year" className="text-sm font-bold">
          {t("yearLabel")}
        </label>
        <select
          id="year"
          name="year"
          defaultValue={v?.year ?? currentYear}
          className={INPUT_CLASS}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="budgetHint" className="text-sm font-bold">
          {t("budgetLabel")}{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="budgetHint"
          name="budgetHint"
          type="text"
          placeholder={t("budgetPlaceholder")}
          defaultValue={v?.budgetHint}
          maxLength={200}
          className={INPUT_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="note" className="text-sm font-bold">
          {t("noteLabel")}{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          id="note"
          name="note"
          placeholder={t("notePlaceholder")}
          defaultValue={v?.note}
          maxLength={1000}
          className={TEXTAREA_CLASS}
        />
      </div>

      {error && <p className="text-danger-text text-sm">{error}</p>}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
