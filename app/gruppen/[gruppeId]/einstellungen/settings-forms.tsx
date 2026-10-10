"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  updateGroupInfo,
  addExclusion,
  removeExclusion,
  promoteToAdmin,
  removeMember,
  deleteGroup,
  invalidateDeletedGroup,
  regenerateInviteLink,
  type RotateInviteState,
  type UpdateGroupState,
  type ExclusionState,
  type RemoveExclusionState,
  type PromoteState,
  type RemoveMemberState,
  type DeleteGroupState,
} from "./actions";
import { createIntlContext } from "@/lib/create-intl-context";
import { CONFIRM_TITLE_CLASS, useConfirmFocus } from "@/lib/use-confirm-focus";

const { Provider: GroupSettingsProvider, useT: useGroupSettingsT } =
  createIntlContext("groupSettings");

export { GroupSettingsProvider };

const INPUT_CLASS =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

const TEXTAREA_CLASS =
  "flex min-h-[80px] w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

export interface Member {
  id: string;
  name_snapshot: string;
  role: "participant" | "admin";
  profile_id: string | null;
}

export interface Exclusion {
  id: string;
  memberA: string;
  memberB: string;
  memberAName: string;
  memberBName: string;
}

export interface GroupInfo {
  slug: string;
  name: string;
  budget_hint: string | null;
  note: string | null;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
      {children}
    </h2>
  );
}

export function UpdateGroupInfoForm({ group }: { group: GroupInfo }) {
  const t = useGroupSettingsT();
  const router = useRouter();
  const [state, action, pending] = useActionState<UpdateGroupState, FormData>(
    updateGroupInfo,
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, router]);

  const errorMsg =
    state.status === "error"
      ? state.error === "missing_name"
        ? t("errors.missingName")
        : state.error === "too_long"
          ? t("errors.tooLong", { max: state.max ?? 0 })
          : state.error === "not_admin"
            ? t("errors.notAdmin")
            : state.error === "group_not_found"
              ? t("errors.groupNotFound")
              : t("errors.generic")
      : null;
  const v = state.status === "error" ? state.values : undefined;

  return (
    <section className="mb-8">
      <SectionHeader>{t("groupInfo.section")}</SectionHeader>
      <form action={action} className="space-y-4">
        <input type="hidden" name="slug" value={group.slug} />
        <div className="space-y-1.5">
          <label htmlFor="name" className="text-sm font-bold">
            {t("groupInfo.nameLabel")}
          </label>
          <input
            id="name"
            name="name"
            type="text"
            defaultValue={v?.name ?? group.name}
            maxLength={100}
            required
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="budgetHint" className="text-sm font-bold">
            {t("groupInfo.budgetLabel")}{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </label>
          <input
            id="budgetHint"
            name="budgetHint"
            type="text"
            defaultValue={v?.budgetHint ?? group.budget_hint ?? ""}
            maxLength={200}
            placeholder={t("groupInfo.budgetPlaceholder")}
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="note" className="text-sm font-bold">
            {t("groupInfo.noteLabel")}{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </label>
          <textarea
            id="note"
            name="note"
            defaultValue={v?.note ?? group.note ?? ""}
            maxLength={1000}
            placeholder={t("groupInfo.notePlaceholder")}
            className={TEXTAREA_CLASS}
          />
        </div>
        {errorMsg && (
          <p role="alert" className="text-danger-text text-sm">
            {errorMsg}
          </p>
        )}
        {state.status === "success" && (
          <p role="status" className="text-success-text text-sm">
            {t("groupInfo.saveSuccess")}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? t("groupInfo.saving") : t("groupInfo.save")}
        </Button>
      </form>
    </section>
  );
}

function RemoveExclusionButton({
  slug,
  exclusion,
}: {
  slug: string;
  exclusion: Exclusion;
}) {
  const t = useGroupSettingsT();
  const router = useRouter();
  const [state, action, pending] = useActionState<
    RemoveExclusionState,
    FormData
  >(removeExclusion, { status: "idle" });

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, router]);

  const errorMsg =
    state.status === "error"
      ? state.error === "not_admin"
        ? t("errors.notAdmin")
        : state.error === "group_not_found"
          ? t("errors.groupNotFound")
          : t("errors.generic")
      : null;

  return (
    <form action={action} className="inline">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="memberA" value={exclusion.memberA} />
      <input type="hidden" name="memberB" value={exclusion.memberB} />
      <Button type="submit" variant="ghost" size="xs" disabled={pending}>
        {pending ? t("exclusions.removing") : t("exclusions.remove")}
      </Button>
      {errorMsg && (
        <p role="alert" className="text-danger-text mt-1 text-xs">
          {errorMsg}
        </p>
      )}
    </form>
  );
}

function AddExclusionForm({
  slug,
  members,
  groupState,
}: {
  slug: string;
  members: Member[];
  groupState: "open" | "drawn";
}) {
  const t = useGroupSettingsT();
  const router = useRouter();
  const [state, action, pending] = useActionState<ExclusionState, FormData>(
    addExclusion,
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, router]);

  const errorMsg =
    state.status === "error"
      ? state.error === "same_member"
        ? t("errors.sameMember")
        : state.error === "invalid_member"
          ? t("errors.invalidMember")
          : state.error === "exists"
            ? t("errors.exclusionExists")
            : state.error === "not_admin"
              ? t("errors.notAdmin")
              : state.error === "rate_limited"
                ? t("errors.rateLimited")
                : t("errors.generic")
      : null;

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="memberA" className="text-sm font-bold">
            {t("exclusions.selectMember")} A
          </label>
          <select
            id="memberA"
            name="memberA"
            className={INPUT_CLASS}
            defaultValue=""
            required
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
        <div className="space-y-1.5">
          <label htmlFor="memberB" className="text-sm font-bold">
            {t("exclusions.selectMember")} B
          </label>
          <select
            id="memberB"
            name="memberB"
            className={INPUT_CLASS}
            defaultValue=""
            required
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
      </div>
      {errorMsg && (
        <p role="alert" className="text-danger-text text-sm">
          {errorMsg}
        </p>
      )}
      {state.status === "success" && state.warning === "unsolvable" && (
        <p className="text-danger-text text-sm" role="alert">
          {t("exclusions.unsolvableWarning")}
        </p>
      )}
      {groupState === "drawn" && (
        <p className="text-muted-foreground text-xs">
          {t("exclusions.effectAfterRedraw")}
        </p>
      )}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? t("exclusions.adding") : t("exclusions.add")}
      </Button>
    </form>
  );
}

function PromoteConfirmPanel({
  slug,
  member,
  onDone,
  onCancel,
}: {
  slug: string;
  member: Member;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useGroupSettingsT();
  const router = useRouter();
  const { titleRef } = useConfirmFocus(true);
  const [state, action, pending] = useActionState<PromoteState, FormData>(
    promoteToAdmin,
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onDone();
    }
  }, [state.status, router, onDone]);

  const errorMsg =
    state.status === "error"
      ? state.error === "not_admin"
        ? t("errors.notAdmin")
        : state.error === "group_not_found"
          ? t("errors.groupNotFound")
          : state.error === "no_account"
            ? t("errors.noAccount")
            : t("errors.generic")
      : null;

  return (
    <div className="border-border bg-muted/30 mt-2 space-y-2 rounded-lg border p-3">
      <p ref={titleRef} tabIndex={-1} className={CONFIRM_TITLE_CLASS}>
        {t("participants.promoteConfirmTitle", { name: member.name_snapshot })}
      </p>
      <p className="text-muted-foreground text-sm">
        {t("participants.promoteConfirmMessage")}
      </p>
      {errorMsg && (
        <p role="alert" className="text-danger-text text-sm">
          {errorMsg}
        </p>
      )}
      <form action={action} className="flex gap-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="membershipId" value={member.id} />
        <Button type="submit" size="xs" disabled={pending}>
          {pending
            ? t("participants.promoting")
            : t("participants.promoteConfirm")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={onCancel}
          disabled={pending}
        >
          {t("participants.cancel")}
        </Button>
      </form>
    </div>
  );
}

function DeleteGroupButton({ slug }: { slug: string }) {
  const t = useGroupSettingsT();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { triggerRef, titleRef } = useConfirmFocus(confirming);
  const [state, action, pending] = useActionState<DeleteGroupState, FormData>(
    deleteGroup,
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status !== "success") return;
    router.push("/gruppen");
    // After navigating: invalidation refreshes the current route, which is
    // gone. Cache expiry for the deleted slug must not race the navigation.
    void invalidateDeletedGroup(slug);
  }, [state.status, router, slug]);

  const errorMsg =
    state.status === "error"
      ? state.error === "not_admin"
        ? t("errors.notAdmin")
        : state.error === "group_not_found"
          ? t("errors.groupNotFound")
          : t("errors.generic")
      : null;

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="destructive"
        onClick={() => setConfirming(true)}
      >
        {t("danger.delete")}
      </Button>
    );
  }

  return (
    <div className="border-destructive/30 bg-destructive/5 space-y-3 rounded-lg border p-4">
      <p ref={titleRef} tabIndex={-1} className={CONFIRM_TITLE_CLASS}>
        {t("danger.confirmTitle")}
      </p>
      <p className="text-muted-foreground text-sm">
        {t("danger.confirmMessage")}
      </p>
      {errorMsg && (
        <p role="alert" className="text-danger-text text-sm">
          {errorMsg}
        </p>
      )}
      <form action={action} className="flex gap-2">
        <input type="hidden" name="slug" value={slug} />
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? t("danger.deleting") : t("danger.confirm")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          {t("danger.cancel")}
        </Button>
      </form>
    </div>
  );
}

export function ExclusionsSection({
  slug,
  members,
  exclusions,
  groupState,
}: {
  slug: string;
  members: Member[];
  exclusions: Exclusion[];
  groupState: "open" | "drawn";
}) {
  const t = useGroupSettingsT();

  return (
    <section className="mb-8">
      <SectionHeader>{t("exclusions.section")}</SectionHeader>
      <p className="text-muted-foreground mb-3 text-sm">
        {t("exclusions.hint")}
      </p>
      {exclusions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("exclusions.empty")}</p>
      ) : (
        <ul className="border-border bg-card divide-y rounded-lg border">
          {exclusions.map((ex) => (
            <li
              key={ex.id}
              className="flex items-center justify-between px-4 py-3 text-sm"
            >
              <span>
                {ex.memberAName} & {ex.memberBName}
              </span>
              <RemoveExclusionButton slug={slug} exclusion={ex} />
            </li>
          ))}
        </ul>
      )}
      <AddExclusionForm slug={slug} members={members} groupState={groupState} />
    </section>
  );
}

type TrackedRemoveState = RemoveMemberState & { membershipId?: string };

function focusById(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

// state/action/pending come from the parent's useActionState: removing a
// member makes this panel's own <li> disappear in the same update that
// delivers a "success" status, so a hook owned here would unmount before its
// effect ever observes that status. ParticipantsSection outlives the removal
// and owns the hook instead.
function RemoveMemberConfirmPanel({
  slug,
  member,
  state,
  action,
  pending,
  onCancel,
}: {
  slug: string;
  member: Member;
  state: TrackedRemoveState;
  action: (formData: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  const t = useGroupSettingsT();
  const { titleRef } = useConfirmFocus(true);

  // Action state is shared across members: only show an error that this
  // panel's own submission produced.
  const errorMsg =
    state.status === "error" && state.membershipId === member.id
      ? state.error === "last_admin"
        ? t("errors.lastAdmin")
        : state.error === "drawn"
          ? t("errors.drawn")
          : state.error === "not_admin"
            ? t("errors.notAdmin")
            : state.error === "group_not_found"
              ? t("errors.groupNotFound")
              : t("errors.generic")
      : null;

  return (
    <div className="border-destructive/30 bg-destructive/5 mt-2 space-y-2 rounded-lg border p-3">
      <p ref={titleRef} tabIndex={-1} className={CONFIRM_TITLE_CLASS}>
        {t("participants.confirmTitle")}
      </p>
      <p className="text-muted-foreground text-sm">
        {t("participants.confirmMessage")}
      </p>
      {errorMsg && (
        <p role="alert" className="text-danger-text text-sm">
          {errorMsg}
        </p>
      )}
      <form action={action} className="flex gap-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="membershipId" value={member.id} />
        <Button
          type="submit"
          variant="destructive"
          size="xs"
          disabled={pending}
        >
          {pending ? t("participants.removing") : t("participants.confirm")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={onCancel}
          disabled={pending}
        >
          {t("participants.cancel")}
        </Button>
      </form>
    </div>
  );
}

export function ParticipantsSection({
  slug,
  members,
  groupState,
  currentMembershipId,
}: {
  slug: string;
  members: Member[];
  groupState: "open" | "drawn";
  currentMembershipId: string;
}) {
  const t = useGroupSettingsT();
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [removeState, removeAction, removePending] = useActionState<
    TrackedRemoveState,
    FormData
  >(
    async (prev, formData) => {
      const next: TrackedRemoveState = await removeMember(prev, formData);
      return { ...next, membershipId: String(formData.get("membershipId")) };
    },
    { status: "idle" },
  );
  const donePromoting = useCallback(() => setPromotingId(null), []);
  // Derived, not stored: once a removal succeeds the removed member's <li>
  // (and its confirm panel) disappears from `members` on its own, and the
  // hint should stay up for the rest of this success status regardless.
  const removedHint = removeState.status === "success";

  useEffect(() => {
    if (removeState.status === "success") {
      router.refresh();
    }
  }, [removeState.status, router]);

  return (
    <section className="mb-8">
      <SectionHeader>{t("participants.section")}</SectionHeader>
      {removedHint && (
        <p
          role="status"
          data-testid="removed-invite-hint"
          className="border-border bg-muted/30 mb-3 rounded-lg border p-3 text-sm"
        >
          {t("participants.removedInviteHint")}
        </p>
      )}
      <ul className="border-border bg-card divide-y rounded-lg border">
        {members.map((m) => (
          <li key={m.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{m.name_snapshot}</span>
              <div className="flex items-center gap-2">
                {m.role === "admin" ? (
                  <span className="text-muted-foreground text-xs">Admin</span>
                ) : m.profile_id ? (
                  <Button
                    id={`promote-${m.id}`}
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setPromotingId(m.id)}
                  >
                    {t("participants.promoteToAdmin")}
                  </Button>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {t("participants.deletedAccount")}
                  </span>
                )}
                {groupState === "open" && m.id !== currentMembershipId && (
                  <Button
                    id={`remove-${m.id}`}
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setConfirmingId(m.id)}
                  >
                    {t("participants.remove")}
                  </Button>
                )}
              </div>
            </div>
            {confirmingId === m.id && (
              <RemoveMemberConfirmPanel
                slug={slug}
                member={m}
                state={removeState}
                action={removeAction}
                pending={removePending}
                onCancel={() => {
                  setConfirmingId(null);
                  focusById(`remove-${m.id}`);
                }}
              />
            )}
            {promotingId === m.id && (
              <PromoteConfirmPanel
                slug={slug}
                member={m}
                onDone={donePromoting}
                onCancel={() => {
                  setPromotingId(null);
                  focusById(`promote-${m.id}`);
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function InviteLinkSection({
  slug,
  groupState,
}: {
  slug: string;
  groupState: "open" | "drawn";
}) {
  const t = useGroupSettingsT();
  const router = useRouter();
  const [state, action, pending] = useActionState<RotateInviteState, FormData>(
    regenerateInviteLink,
    { status: "idle" },
  );
  // Confirm panel is open until a (new) success state arrives.
  const [openedAgainst, setOpenedAgainst] = useState<RotateInviteState | null>(
    null,
  );
  const confirming =
    openedAgainst !== null &&
    !(state.status === "success" && state !== openedAgainst);

  const { triggerRef, titleRef } = useConfirmFocus(confirming);

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, router]);

  if (groupState === "drawn") return null;

  const errorMsg =
    state.status === "error"
      ? state.error === "not_admin"
        ? t("errors.notAdmin")
        : state.error === "group_not_found"
          ? t("errors.groupNotFound")
          : t("errors.generic")
      : null;

  return (
    <section className="mb-8" data-testid="invite-link-section">
      <SectionHeader>{t("inviteLink.section")}</SectionHeader>
      <p className="text-muted-foreground mb-3 text-sm">
        {t("inviteLink.hint")}
      </p>
      {state.status === "success" && (
        <p role="status" className="text-success-text mb-3 text-sm">
          {t("inviteLink.success")}
        </p>
      )}
      {!confirming ? (
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          onClick={() => setOpenedAgainst(state)}
        >
          {t("inviteLink.regenerate")}
        </Button>
      ) : (
        <form
          action={action}
          className="border-border bg-muted/30 space-y-3 rounded-lg border p-4"
        >
          <input type="hidden" name="slug" value={slug} />
          <p ref={titleRef} tabIndex={-1} className={CONFIRM_TITLE_CLASS}>
            {t("inviteLink.confirmTitle")}
          </p>
          <p className="text-muted-foreground text-sm">
            {t("inviteLink.confirmMessage")}
          </p>
          {errorMsg && (
            <p role="alert" className="text-danger-text text-sm">
              {errorMsg}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t("inviteLink.regenerating") : t("inviteLink.confirm")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpenedAgainst(null)}
              disabled={pending}
            >
              {t("inviteLink.cancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export function DangerSection({ slug }: { slug: string }) {
  const t = useGroupSettingsT();

  return (
    <section className="mb-8">
      <SectionHeader>{t("danger.section")}</SectionHeader>
      <DeleteGroupButton slug={slug} />
    </section>
  );
}
