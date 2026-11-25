"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  XCircleIcon,
} from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { createIntlContext } from "@/lib/create-intl-context";
import { cn } from "@/lib/utils";
import type {
  DistributionNode,
  DistributionView,
} from "@/lib/draw/distribution";
import { revealMemberName } from "./actions";

const { Provider: DistributionProvider, useT } =
  createIntlContext("distribution");

export { DistributionProvider };

/** Delay between click and reveal; clicking the eye again cancels. */
const REVEAL_DELAY_MS = 3000;
const ROW_HEIGHT = 48;

type Translate = ReturnType<typeof useT>;

function without(set: Set<string>, label: string) {
  const next = new Set(set);
  next.delete(label);
  return next;
}

function withLabel(set: Set<string>, label: string) {
  return new Set(set).add(label);
}

export function DistributionClient({
  slug,
  view,
}: {
  slug: string;
  view: DistributionView;
}) {
  const t = useT();
  const [mode, setMode] = useState<"arrows" | "list">("arrows");
  const [active, setActive] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      view.nodes.filter((n) => n.name).map((n) => [n.label, n.name!]),
    ),
  );
  const [shown, setShown] = useState<Set<string>>(
    () => new Set(view.nodes.filter((n) => n.isMe).map((n) => n.label)),
  );
  const [arming, setArming] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [announce, setAnnounce] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending.values()) clearTimeout(id);
      pending.clear();
    };
  }, []);

  const person = (label: string) => t("person", { label });

  function finishReveal(label: string, cached: boolean) {
    timers.current.delete(label);
    setArming((s) => without(s, label));
    setAnnounce("");
    if (cached) {
      setShown((s) => withLabel(s, label));
      return;
    }
    setLoading((s) => withLabel(s, label));
    void revealMemberName(slug, label)
      .then((res) => {
        if (res.status === "success") {
          setNames((n) => ({ ...n, [res.label]: res.name }));
          setShown((s) => withLabel(s, res.label));
        } else {
          setErrorKey(res.error);
        }
      })
      .catch(() => setErrorKey("generic"))
      .finally(() => setLoading((s) => without(s, label)));
  }

  function toggle(label: string) {
    const running = timers.current.get(label);
    if (running) {
      // Second click during the countdown: nothing was sent to the server.
      clearTimeout(running);
      timers.current.delete(label);
      setArming((s) => without(s, label));
      setAnnounce(t("reveal.cancelled"));
      return;
    }
    if (loading.has(label)) return;
    if (shown.has(label)) {
      setShown((s) => without(s, label));
      return;
    }
    setErrorKey(null);
    setArming((s) => withLabel(s, label));
    setAnnounce(
      t("reveal.countdown", {
        label: person(label),
        seconds: REVEAL_DELAY_MS / 1000,
      }),
    );
    timers.current.set(
      label,
      setTimeout(() => finishReveal(label, label in names), REVEAL_DELAY_MS),
    );
  }

  const nodeByLabel = new Map(view.nodes.map((n) => [n.label, n]));
  const receiverOf = new Map(view.arrows.map((a) => [a.from, a.to]));
  const errorMessage = errorKey
    ? errorKey === "not_admin"
      ? t("errors.notAdmin")
      : errorKey === "not_found"
        ? t("errors.notFound")
        : errorKey === "rate_limited"
          ? t("errors.rateLimited")
          : t("errors.generic")
    : null;

  function renderPerson(label: string, side: "left" | "right") {
    const node = nodeByLabel.get(label)!;
    return (
      <PersonCell
        node={node}
        side={side}
        text={
          shown.has(label) ? (names[label] ?? person(label)) : person(label)
        }
        isActive={active === label}
        isArming={arming.has(label)}
        isLoading={loading.has(label)}
        isShown={shown.has(label)}
        t={t}
        onActivate={() => setActive((a) => (a === label ? null : label))}
        onToggle={() => toggle(label)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <ChecksPanel check={view.check} t={t} />

      <section aria-labelledby="distribution-graph-title" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="distribution-graph-title"
            className="text-muted-foreground text-sm font-semibold tracking-wide uppercase"
          >
            {t("viewLabel")}
          </h2>
          <div role="group" aria-label={t("viewLabel")} className="flex gap-1">
            {(["arrows", "list"] as const).map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={mode === m ? "default" : "outline"}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m === "arrows" ? t("viewArrows") : t("viewList")}
              </Button>
            ))}
          </div>
        </div>

        <p
          role="status"
          className="text-muted-foreground min-h-5 text-sm"
          data-testid="reveal-status"
        >
          {announce}
        </p>
        <FormError>{errorMessage}</FormError>

        <div className="border-border bg-card rounded-lg border p-3 sm:p-4">
          {mode === "arrows" ? (
            <ArrowsView
              view={view}
              active={active}
              receiverOf={receiverOf}
              t={t}
              renderPerson={renderPerson}
            />
          ) : (
            <ul className="space-y-1" data-testid="distribution-list">
              {view.nodes.map((n) => {
                const to = receiverOf.get(n.label);
                return (
                  <li
                    key={n.label}
                    className="grid min-h-12 grid-cols-[1fr_auto_1fr] items-center gap-2"
                  >
                    {renderPerson(n.label, "left")}
                    <ArrowRightIcon aria-hidden="true" size={16} />
                    {to ? (
                      renderPerson(to, "right")
                    ) : (
                      <span className="text-danger-text text-sm">
                        {t("missingArrow")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-muted-foreground text-xs">{t("highlightHint")}</p>
      </section>
    </div>
  );
}

function PersonCell({
  node,
  side,
  text,
  isActive,
  isArming,
  isLoading,
  isShown,
  t,
  onActivate,
  onToggle,
}: {
  node: DistributionNode;
  side: "left" | "right";
  text: string;
  isActive: boolean;
  isArming: boolean;
  isLoading: boolean;
  isShown: boolean;
  t: Translate;
  onActivate: () => void;
  onToggle: () => void;
}) {
  const label = node.label;
  const pseudonym = t("person", { label });
  const eyeLabel = isArming
    ? t("reveal.cancel", { label: pseudonym })
    : isLoading
      ? t("reveal.loading", { label: pseudonym })
      : isShown
        ? t("reveal.hide", { label: pseudonym })
        : t("reveal.show", { label: pseudonym });

  const eye = node.isMe ? (
    <span className="size-6 shrink-0" aria-hidden="true" />
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="shrink-0"
      aria-label={eyeLabel}
      aria-pressed={isShown || isArming}
      disabled={isLoading}
      data-testid={`reveal-${side}-${label}`}
      onClick={onToggle}
    >
      {isShown ? (
        <EyeSlashIcon aria-hidden="true" size={16} />
      ) : (
        <EyeIcon aria-hidden="true" size={16} />
      )}
    </Button>
  );

  const chip = (
    <button
      type="button"
      aria-pressed={isActive}
      title={node.ghost ? t("ghost") : undefined}
      data-testid={`person-${side}-${label}`}
      data-state={isArming ? "arming" : isShown ? "shown" : "hidden"}
      onClick={onActivate}
      className={cn(
        "border-border min-w-0 flex-1 truncate rounded-md border bg-white/60 px-2 py-1 text-left text-sm font-semibold",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        isActive && "border-navy bg-white",
        node.ghost && "border-dashed",
        isArming &&
          "ring-crimson animate-pulse ring-2 motion-reduce:animate-none",
      )}
    >
      {text}
      {node.isMe && (
        <span className="text-muted-foreground font-normal"> ({t("you")})</span>
      )}
      {node.ghost && <span className="sr-only"> ({t("ghost")})</span>}
    </button>
  );

  return (
    <div className="flex h-12 min-w-0 items-center gap-1">
      {side === "left" ? (
        <>
          {eye}
          {chip}
        </>
      ) : (
        <>
          {chip}
          {eye}
        </>
      )}
    </div>
  );
}

function ArrowsView({
  view,
  active,
  receiverOf,
  t,
  renderPerson,
}: {
  view: DistributionView;
  active: string | null;
  receiverOf: Map<string, string>;
  t: Translate;
  renderPerson: (label: string, side: "left" | "right") => React.ReactNode;
}) {
  const index = new Map(view.nodes.map((n, i) => [n.label, i]));
  const height = view.nodes.length * ROW_HEIGHT;
  const y = (label: string) => (index.get(label)! + 0.5) * ROW_HEIGHT;

  const bad = new Set<string>();
  for (const a of view.arrows)
    if (a.from === a.to) bad.add(`${a.from}>${a.to}`);
  for (const [a, b] of [
    ...view.check.mutualPairs,
    ...view.check.exclusionViolations,
  ]) {
    bad.add(`${a}>${b}`);
    bad.add(`${b}>${a}`);
  }

  const related = (a: { from: string; to: string }) =>
    active !== null && (a.from === active || a.to === active);
  // Highlighted lines last so they sit on top.
  const ordered = [...view.arrows].sort(
    (a, b) => Number(related(a)) - Number(related(b)),
  );

  return (
    <div data-testid="distribution-arrows">
      <div className="grid grid-cols-[1fr_3rem_1fr] gap-x-0 sm:grid-cols-[1fr_8rem_1fr]">
        <h3 className="text-muted-foreground pb-2 text-xs font-semibold uppercase">
          {t("giversTitle")}
        </h3>
        <span />
        <h3 className="text-muted-foreground pb-2 text-right text-xs font-semibold uppercase">
          {t("receiversTitle")}
        </h3>

        <ol className="m-0 list-none p-0">
          {view.nodes.map((n) => (
            <li key={n.label}>
              {renderPerson(n.label, "left")}
              {receiverOf.has(n.label) && (
                <span className="sr-only">
                  {t("gives", {
                    label: t("person", { label: receiverOf.get(n.label)! }),
                  })}
                </span>
              )}
            </li>
          ))}
        </ol>

        <div className="relative" style={{ height }}>
          <svg
            aria-hidden="true"
            className="absolute inset-0 size-full overflow-visible"
            viewBox={`0 0 100 ${height}`}
            preserveAspectRatio="none"
          >
            {ordered.map((a) => {
              const key = `${a.from}>${a.to}`;
              const isRelated = related(a);
              const isBad = bad.has(key);
              const y1 = y(a.from);
              const y2 = y(a.to);
              return (
                <path
                  key={key}
                  data-testid={`arrow-${a.from}-${a.to}`}
                  data-bad={isBad ? "true" : undefined}
                  d={`M0,${y1} C50,${y1} 50,${y2} 100,${y2}`}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  className={isBad ? "stroke-crimson" : "stroke-navy-soft"}
                  strokeWidth={isRelated || isBad ? 3 : 2}
                  strokeLinecap="round"
                  opacity={active === null ? 0.6 : isRelated ? 1 : 0.1}
                />
              );
            })}
          </svg>
        </div>

        <ol className="m-0 list-none p-0">
          {view.nodes.map((n) => (
            <li key={n.label}>{renderPerson(n.label, "right")}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function ChecksPanel({
  check,
  t,
}: {
  check: DistributionView["check"];
  t: Translate;
}) {
  const list = (labels: string[]) =>
    labels.map((l) => t("person", { label: l })).join(", ");
  const pairs = (p: [string, string][]) =>
    p
      .map(
        ([a, b]) =>
          `${t("person", { label: a })} ↔ ${t("person", { label: b })}`,
      )
      .join(", ");

  const items: {
    key: string;
    ok: boolean;
    title: string;
    details: string[];
  }[] = [
    {
      key: "allGive",
      ok: !check.missingGiver.length && !check.multipleGiver.length,
      title: t("checks.allGive"),
      details: [
        check.missingGiver.length
          ? t("checks.missingGiver", { list: list(check.missingGiver) })
          : "",
        check.multipleGiver.length
          ? t("checks.multipleGiver", { list: list(check.multipleGiver) })
          : "",
      ],
    },
    {
      key: "allReceive",
      ok: !check.missingReceiver.length && !check.multipleReceiver.length,
      title: t("checks.allReceive"),
      details: [
        check.missingReceiver.length
          ? t("checks.missingReceiver", { list: list(check.missingReceiver) })
          : "",
        check.multipleReceiver.length
          ? t("checks.multipleReceiver", {
              list: list(check.multipleReceiver),
            })
          : "",
      ],
    },
    {
      key: "noSelf",
      ok: !check.selfAssigned.length,
      title: t("checks.noSelf"),
      details: [
        check.selfAssigned.length
          ? t("checks.selfAssigned", { list: list(check.selfAssigned) })
          : "",
      ],
    },
    {
      key: "noMutual",
      ok: !check.mutualPairs.length,
      title: t("checks.noMutual"),
      details: [
        check.mutualPairs.length
          ? t("checks.mutualPairs", { list: pairs(check.mutualPairs) })
          : "",
      ],
    },
    {
      key: "exclusions",
      ok: !check.exclusionViolations.length,
      title: check.exclusionCount
        ? t("checks.exclusions", { count: check.exclusionCount })
        : t("checks.exclusionsNone"),
      details: [
        check.exclusionViolations.length
          ? t("checks.exclusionViolations", {
              list: pairs(check.exclusionViolations),
            })
          : "",
      ],
    },
    {
      key: "unknown",
      ok: check.unknownEndpoints === 0,
      title: t("checks.unknown"),
      details: [
        check.unknownEndpoints
          ? t("checks.unknownCount", { count: check.unknownEndpoints })
          : "",
      ],
    },
  ];

  return (
    <section
      aria-labelledby="distribution-checks-title"
      className="border-border bg-card space-y-3 rounded-lg border p-4"
      data-testid="distribution-checks"
      data-ok={check.ok ? "true" : "false"}
    >
      <h2
        id="distribution-checks-title"
        className="text-muted-foreground text-sm font-semibold tracking-wide uppercase"
      >
        {t("checks.title")}
      </h2>
      <p
        className={cn(
          "text-sm font-bold",
          check.ok ? "text-success-text" : "text-danger-text",
        )}
      >
        {check.ok ? t("summaryOk") : t("summaryFailed")}
      </p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.key}
            data-testid={`check-${item.key}`}
            data-ok={item.ok ? "true" : "false"}
            className="flex items-start gap-2 text-sm"
          >
            {item.ok ? (
              <CheckCircleIcon
                aria-hidden="true"
                weight="duotone"
                size={18}
                className="text-success-text mt-0.5 shrink-0"
              />
            ) : (
              <XCircleIcon
                aria-hidden="true"
                weight="duotone"
                size={18}
                className="text-danger-text mt-0.5 shrink-0"
              />
            )}
            <span>
              {item.title}{" "}
              <span
                className={cn(
                  "font-semibold",
                  item.ok ? "text-success-text" : "text-danger-text",
                )}
              >
                ({item.ok ? t("checks.ok") : t("checks.failed")})
              </span>
              {item.details.filter(Boolean).map((d) => (
                <span key={d} className="text-danger-text block">
                  {d}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
