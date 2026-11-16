import type { Metadata } from "next";
import type { Route } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { getMessages, getTranslations } from "next-intl/server";
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  GiftIcon,
} from "@phosphor-icons/react/ssr";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-auth";
import { loadMembershipsWithGroups } from "@/lib/group-reads";
import { loadWishes, type Wish } from "@/lib/wishes";
import {
  ARCHIVE_PARAM,
  filterWishes,
  hasActiveFilter,
  parseWishFilter,
  type WishFilter,
} from "@/lib/wishes/filter";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/ui/loading-region";
import {
  QuickAddForm,
  WishEditForm,
  WishRowActions,
  WishesProvider,
  type GroupOption,
} from "./wish-forms";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("wishes");
  return { title: t("title") };
}

function WishesSkeleton() {
  return (
    <LoadingRegion className="space-y-4">
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-lg" />
      ))}
    </LoadingRegion>
  );
}

export default async function WuenschePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = await getTranslations("wishes");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-8 flex items-center gap-3">
        <Link
          href="/gruppen"
          className="text-muted-foreground hover:text-foreground flex min-h-11 items-center gap-1 text-sm transition-colors"
        >
          <ArrowLeftIcon size={16} aria-hidden="true" />
          {t("backToGroups")}
        </Link>
      </div>
      <h1 className="mb-2 text-2xl font-bold">{t("title")}</h1>
      <p className="text-muted-foreground mb-8 text-sm">{t("intro")}</p>

      <Suspense fallback={<WishesSkeleton />}>
        <WuenscheContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** `/wuensche` URL keeping the active view + filters. */
function listHref(
  filter: WishFilter,
  extra: { edit?: string; view?: WishFilter["view"] } = {},
): Route {
  const params = new URLSearchParams();
  if ((extra.view ?? filter.view) === "received")
    params.set("status", ARCHIVE_PARAM);
  if (filter.q) params.set("q", filter.q);
  if (filter.group !== "all") params.set("group", filter.group);
  if (extra.edit) params.set("edit", extra.edit);
  const qs = params.toString();
  return (qs ? `/wuensche?${qs}` : "/wuensche") as Route;
}

function priceInput(price: number | null): string {
  return price === null ? "" : String(price).replace(".", ",");
}

async function WuenscheContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = await getTranslations("wishes");
  const messages = await getMessages();
  const params = await searchParams;
  const filter = parseWishFilter(params);
  const editParam = params.edit;
  const editId = typeof editParam === "string" ? editParam : null;

  const user = await requireUser();
  const supabase = await createClient();
  const [wishes, memberships] = await Promise.all([
    loadWishes(supabase, user.id),
    loadMembershipsWithGroups(supabase, user.id),
  ]);

  const groups: GroupOption[] = memberships.map((m) => ({
    id: m.group_id,
    label: `${m.groups.name} (${m.groups.year})`,
  }));
  const groupLabel = new Map(groups.map((g) => [g.id, g.label]));

  const openCount = wishes.filter((w) => w.status === "open").length;
  const archiveCount = wishes.length - openCount;
  const visible = filterWishes(wishes, filter);
  const filtered = hasActiveFilter(filter);

  const priceFormat = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  });
  const dateFormat = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeZone: "Europe/Berlin",
  });

  const tabs = [
    { view: "open", label: t("views.open"), count: openCount },
    { view: "received", label: t("views.archive"), count: archiveCount },
  ] as const;

  return (
    <WishesProvider messages={{ wishes: messages.wishes }}>
      <div className="space-y-6">
        <QuickAddForm />

        <nav aria-label={t("views.label")} className="flex gap-2">
          {tabs.map((tab) => {
            const active = filter.view === tab.view;
            return (
              <Link
                key={tab.view}
                href={listHref(filter, { view: tab.view })}
                aria-current={active ? "page" : undefined}
                data-testid={`wish-tab-${tab.view}`}
                className={buttonVariants({
                  variant: active ? "default" : "outline",
                  size: "sm",
                })}
              >
                {tab.label} ({tab.count})
              </Link>
            );
          })}
        </nav>

        <form
          method="get"
          action="/wuensche"
          role="search"
          aria-label={t("filter.label")}
          className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
        >
          {filter.view === "received" && (
            <input type="hidden" name="status" value={ARCHIVE_PARAM} />
          )}
          <div className="space-y-1.5">
            <label htmlFor="wish-q" className="text-sm font-bold">
              {t("filter.search")}
            </label>
            <Input
              id="wish-q"
              name="q"
              type="search"
              defaultValue={filter.q}
              maxLength={100}
              placeholder={t("filter.searchPlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wish-group" className="text-sm font-bold">
              {t("filter.group")}
            </label>
            <Select id="wish-group" name="group" defaultValue={filter.group}>
              <option value="all">{t("filter.groupAll")}</option>
              <option value="none">{t("filter.groupNone")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonVariants()}>
              {t("filter.apply")}
            </button>
            {filtered && (
              <Link
                href={listHref(
                  { ...filter, q: "", group: "all" },
                  { view: filter.view },
                )}
                className={buttonVariants({ variant: "outline" })}
              >
                {t("filter.reset")}
              </Link>
            )}
          </div>
        </form>

        {visible.length === 0 ? (
          <section className="border-border bg-card rounded-xl border border-dashed px-6 py-10 text-center shadow-sm">
            <span className="bg-crimson/15 text-danger-text mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full">
              <GiftIcon
                aria-hidden="true"
                className="size-5"
                weight="duotone"
              />
            </span>
            <p className="text-muted-foreground" data-testid="wish-empty">
              {filtered
                ? t("list.emptyFiltered")
                : filter.view === "open"
                  ? t("list.emptyOpen")
                  : t("list.emptyArchive")}
            </p>
          </section>
        ) : (
          <ul className="space-y-3">
            {visible.map((wish) => (
              <li
                key={wish.id}
                data-testid="wish-item"
                className="border-border bg-card rounded-lg border px-4 py-3"
              >
                {wish.id === editId ? (
                  <WishEditForm
                    wish={{
                      id: wish.id,
                      title: wish.title,
                      url: wish.url,
                      note: wish.note,
                      priceInput: priceInput(wish.price_estimate),
                      groupId: groupLabel.has(wish.group_id ?? "")
                        ? wish.group_id
                        : null,
                    }}
                    groups={groups}
                    view={filter.view === "received" ? ARCHIVE_PARAM : null}
                    cancelHref={listHref(filter)}
                  />
                ) : (
                  <WishItem
                    wish={wish}
                    t={t}
                    groupName={
                      wish.group_id ? groupLabel.get(wish.group_id) : undefined
                    }
                    price={
                      wish.price_estimate === null
                        ? null
                        : priceFormat.format(wish.price_estimate)
                    }
                    receivedOn={
                      wish.received_at
                        ? dateFormat.format(new Date(wish.received_at))
                        : null
                    }
                    editHref={listHref(filter, { edit: wish.id })}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </WishesProvider>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function WishItem({
  wish,
  t,
  groupName,
  price,
  receivedOn,
  editHref,
}: {
  wish: Wish;
  t: Awaited<ReturnType<typeof getTranslations<"wishes">>>;
  groupName: string | undefined;
  price: string | null;
  receivedOn: string | null;
  editHref: Route;
}) {
  return (
    <>
      <p className="font-medium break-words">{wish.title}</p>
      <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {price && <span>{t("item.price", { price })}</span>}
        {groupName && <span>{groupName}</span>}
        {receivedOn && (
          <span>{t("item.receivedOn", { date: receivedOn })}</span>
        )}
      </div>
      {wish.url && (
        <p className="mt-1 text-sm break-all">
          <a
            href={wish.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-navy inline-flex items-center gap-1 underline underline-offset-4 hover:no-underline"
          >
            {t("item.link", { host: hostOf(wish.url) })}
            <ArrowSquareOutIcon aria-hidden="true" size={14} />
            <span className="sr-only">{t("item.linkNewTab")}</span>
          </a>
        </p>
      )}
      {wish.note && (
        <p className="text-muted-foreground mt-2 text-sm break-words whitespace-pre-line">
          {wish.note}
        </p>
      )}
      <WishRowActions id={wish.id} status={wish.status} editHref={editHref} />
    </>
  );
}
