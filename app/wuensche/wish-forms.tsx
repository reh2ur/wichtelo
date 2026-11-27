"use client";

import { useActionState, useRef, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormError, errorFieldProps } from "@/components/form-error";
import { createIntlContext } from "@/lib/create-intl-context";
import { useHydrated } from "@/lib/use-hydrated";
import { CONFIRM_TITLE_CLASS, useConfirmFocus } from "@/lib/use-confirm-focus";
import { WISH_LIMITS } from "@/lib/wishes/schema";
import {
  addWish,
  fetchLinkPreview,
  updateWish,
  setWishStatus,
  deleteWish,
  type WishActionState,
  type WishError,
  type WishField,
  type WishFormState,
} from "./actions";

const { Provider: WishesProvider, useT: useWishesT } =
  createIntlContext("wishes");

export { WishesProvider };

type T = ReturnType<typeof useWishesT>;

function errorMessage(t: T, error: WishError, max?: number): string {
  switch (error) {
    case "required":
      return t("errors.required");
    case "too_long":
      return t("errors.tooLong", { max: max ?? 0 });
    case "invalid_url":
      return t("errors.invalidUrl");
    case "invalid_price":
      return t("errors.invalidPrice");
    case "invalid_group":
      return t("errors.invalidGroup");
    case "limit_reached":
      return t("errors.limitReached", { max: max ?? WISH_LIMITS.perAccount });
    case "profile_required":
      return t("errors.profileRequired");
    case "not_found":
      return t("errors.notFound");
    default:
      return t("errors.generic");
  }
}

function fieldProps(state: WishFormState, field: WishField, errorId: string) {
  return errorFieldProps(
    errorId,
    state.status === "error" && state.field === field,
  );
}

/** Step 1: title only. Success redirects to the details step. */
export function QuickAddForm() {
  const t = useWishesT();
  const hydrated = useHydrated();
  const [state, action, pending] = useActionState<WishFormState, FormData>(
    addWish,
    { status: "idle" },
  );
  const error =
    state.status === "error" ? errorMessage(t, state.error, state.max) : null;

  return (
    <form action={action} className="space-y-2" data-testid="wish-quick-add">
      <label htmlFor="quick-title" className="text-sm font-bold">
        {t("quickAdd.label")}
      </label>
      <div className="flex gap-2">
        <Input
          id="quick-title"
          name="title"
          type="text"
          placeholder={t("quickAdd.placeholder")}
          defaultValue={state.status === "error" ? state.values.title : ""}
          maxLength={WISH_LIMITS.title}
          required
          {...fieldProps(state, "title", "quick-add-error")}
        />
        <Button type="submit" disabled={pending || !hydrated}>
          {pending ? t("quickAdd.submitting") : t("quickAdd.submit")}
        </Button>
      </div>
      <FormError id="quick-add-error">{error}</FormError>
    </form>
  );
}

/**
 * Hotlinked third-party image (#210): never `next/image` (needs a host
 * allowlist), `no-referrer` so the shop learns nothing about this app, fixed
 * aspect box, decorative (`alt=""`). A broken image just disappears.
 */
export function WishImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div
      className="bg-muted aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-md"
      data-testid="wish-image"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

/** Site icon (favicon) next to the link; hotlinked, hides itself on error. */
export function WishIcon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-sm object-contain"
      data-testid="wish-icon"
    />
  );
}

type PreviewHint = "loading" | "filled" | "none" | "limited" | null;

export interface GroupOption {
  id: string;
  label: string;
}

/** Step 2 / edit: all fields. Success redirects back to the list. */
export function WishEditForm({
  wish,
  groups,
  view,
  cancelHref,
}: {
  wish: {
    id: string;
    title: string;
    url: string | null;
    note: string | null;
    linkTitle: string | null;
    linkImageUrl: string | null;
    linkBrand: string | null;
    linkIconUrl: string | null;
    priceInput: string;
    groupId: string | null;
  };
  groups: GroupOption[];
  /** `archiv` when editing from the archive view. */
  view: string | null;
  cancelHref: Route;
}) {
  const t = useWishesT();
  const hydrated = useHydrated();
  const [state, action, pending] = useActionState<WishFormState, FormData>(
    updateWish,
    { status: "idle" },
  );
  const v = state.status === "error" ? state.values : undefined;
  const error =
    state.status === "error" ? errorMessage(t, state.error, state.max) : null;
  const errorId = `wish-error-${wish.id}`;
  const id = (name: string) => `${name}-${wish.id}`;

  // Controlled so the link preview can prefill them (everything stays editable).
  const [title, setTitle] = useState(v?.title ?? wish.title);
  const [price, setPrice] = useState(v?.price ?? wish.priceInput);
  const [meta, setMeta] = useState({
    title: wish.linkTitle,
    imageUrl: wish.linkImageUrl,
    brand: wish.linkBrand,
    iconUrl: wish.linkIconUrl,
  });
  const [hint, setHint] = useState<PreviewHint>(null);
  const titleTouched = useRef(false);
  const lastUrl = useRef((v?.url ?? wish.url ?? "").trim());

  async function previewFor(raw: string) {
    const value = raw.trim();
    if (value === lastUrl.current) return;
    lastUrl.current = value;
    setMeta({ title: null, imageUrl: null, brand: null, iconUrl: null });
    if (!value) {
      setHint(null);
      return;
    }
    setHint("loading");
    let result: Awaited<ReturnType<typeof fetchLinkPreview>>;
    try {
      result = await fetchLinkPreview(value);
    } catch {
      result = { status: "none" };
    }
    if (lastUrl.current !== value) return; // URL changed meanwhile
    if (result.status !== "ok") {
      setHint(result.status === "rate_limited" ? "limited" : "none");
      return;
    }
    setMeta({
      title: result.title,
      imageUrl: result.imageUrl,
      brand: result.brand,
      iconUrl: result.iconUrl,
    });
    if (result.title && !titleTouched.current) setTitle(result.title);
    if (result.price)
      setPrice((p) => (p.trim() ? p : result.price!.replace(".", ",")));
    setHint("filled");
  }

  return (
    <form
      action={action}
      className="space-y-4"
      noValidate
      data-testid="wish-edit-form"
    >
      <input type="hidden" name="id" value={wish.id} />
      {view && <input type="hidden" name="view" value={view} />}
      <input type="hidden" name="linkTitle" value={meta.title ?? ""} />
      <input type="hidden" name="linkImageUrl" value={meta.imageUrl ?? ""} />
      <input type="hidden" name="linkBrand" value={meta.brand ?? ""} />
      <input type="hidden" name="linkIconUrl" value={meta.iconUrl ?? ""} />
      <p className="text-muted-foreground text-sm">{t("form.hint")}</p>

      <div className="space-y-1.5">
        <label htmlFor={id("title")} className="text-sm font-bold">
          {t("form.title")}
        </label>
        <Input
          id={id("title")}
          name="title"
          type="text"
          value={title}
          onChange={(e) => {
            titleTouched.current = true;
            setTitle(e.target.value);
          }}
          maxLength={WISH_LIMITS.title}
          required
          {...fieldProps(state, "title", errorId)}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={id("url")} className="text-sm font-bold">
          {t("form.url")}{" "}
          <span className="text-muted-foreground font-normal">
            {t("form.optional")}
          </span>
        </label>
        <Input
          id={id("url")}
          name="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder={t("form.urlPlaceholder")}
          defaultValue={v?.url ?? wish.url ?? ""}
          onBlur={(e) => void previewFor(e.currentTarget.value)}
          onPaste={(e) => {
            const el = e.currentTarget;
            setTimeout(() => void previewFor(el.value), 0);
          }}
          aria-describedby={`${id("url-hint")}`}
          {...fieldProps(state, "url", errorId)}
        />
        <p
          id={id("url-hint")}
          role="status"
          className="text-muted-foreground text-sm"
          data-testid="link-preview-hint"
        >
          {hint === "loading" && t("preview.loading")}
          {hint === "filled" && t("preview.filled")}
          {hint === "none" && t("preview.none")}
          {hint === "limited" && t("preview.limited")}
        </p>
        {meta.imageUrl && <WishImage key={meta.imageUrl} src={meta.imageUrl} />}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={id("price")} className="text-sm font-bold">
          {t("form.price")}{" "}
          <span className="text-muted-foreground font-normal">
            {t("form.optional")}
          </span>
        </label>
        <Input
          id={id("price")}
          name="price"
          type="text"
          inputMode="decimal"
          placeholder={t("form.pricePlaceholder")}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          {...fieldProps(state, "price", errorId)}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={id("note")} className="text-sm font-bold">
          {t("form.note")}{" "}
          <span className="text-muted-foreground font-normal">
            {t("form.optional")}
          </span>
        </label>
        <Textarea
          id={id("note")}
          name="note"
          defaultValue={v?.note ?? wish.note ?? ""}
          maxLength={WISH_LIMITS.note}
          {...fieldProps(state, "note", errorId)}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={id("group")} className="text-sm font-bold">
          {t("form.group")}{" "}
          <span className="text-muted-foreground font-normal">
            {t("form.optional")}
          </span>
        </label>
        <Select
          id={id("group")}
          name="groupId"
          defaultValue={v?.groupId ?? wish.groupId ?? ""}
          {...fieldProps(state, "group", errorId)}
        >
          <option value="">{t("form.groupNone")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </Select>
      </div>

      <FormError id={errorId}>{error}</FormError>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !hydrated}>
          {pending ? t("form.saving") : t("form.save")}
        </Button>
        <Link
          href={cancelHref}
          scroll={false}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("form.cancel")}
        </Link>
      </div>
    </form>
  );
}

/** Archive / reopen + delete (with inline confirm panel) for one wish. */
export function WishRowActions({
  id,
  status,
  editHref,
}: {
  id: string;
  status: "open" | "received";
  editHref: Route;
}) {
  const t = useWishesT();
  const [confirming, setConfirming] = useState(false);
  const { triggerRef, titleRef } = useConfirmFocus(confirming);
  const [statusState, statusAction, statusPending] = useActionState<
    WishActionState,
    FormData
  >(setWishStatus, { status: "idle" });
  const [deleteState, deleteAction, deletePending] = useActionState<
    WishActionState,
    FormData
  >(deleteWish, { status: "idle" });

  const error =
    statusState.status === "error"
      ? errorMessage(t, statusState.error)
      : deleteState.status === "error"
        ? errorMessage(t, deleteState.error)
        : null;

  if (confirming) {
    return (
      <div className="border-destructive/30 bg-destructive/5 mt-3 space-y-3 rounded-lg border p-4">
        <p ref={titleRef} tabIndex={-1} className={CONFIRM_TITLE_CLASS}>
          {t("delete.confirmTitle")}
        </p>
        <p className="text-muted-foreground text-sm">
          {t("delete.confirmMessage")}
        </p>
        <FormError>{error}</FormError>
        <form action={deleteAction} className="flex gap-2">
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="destructive" disabled={deletePending}>
            {deletePending ? t("delete.deleting") : t("delete.confirm")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirming(false)}
            disabled={deletePending}
          >
            {t("delete.cancel")}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={statusAction}>
          <input type="hidden" name="id" value={id} />
          <input
            type="hidden"
            name="to"
            value={status === "open" ? "received" : "open"}
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={statusPending}
          >
            {status === "open" ? t("item.markReceived") : t("item.reopen")}
          </Button>
        </form>
        <Link
          href={editHref}
          scroll={false}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {t("item.edit")}
        </Link>
        <Button
          ref={triggerRef}
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => setConfirming(true)}
        >
          {t("item.delete")}
        </Button>
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
