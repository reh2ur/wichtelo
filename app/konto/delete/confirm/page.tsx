import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { verifyDeletionToken, isDeletionNonceCurrent } from "@/lib/account";
import { getUser } from "@/lib/auth/get-user";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { confirmAccountDeletion } from "./actions";
import { ConfirmSubmitButton } from "./confirm-submit-button";

export const metadata = { robots: { index: false, follow: false } };

export default function ConfirmDeletionPage(
  props: PageProps<"/konto/delete/confirm">,
) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-16">
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-lg" />}>
        <ConfirmContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

const ERROR_KEYS = ["sole_admin", "generic", "invalid", "wrong_account"];

async function ConfirmContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("accountDeletion");
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const errorParam = typeof params.error === "string" ? params.error : "";

  const verified = verifyDeletionToken(token);
  if (
    !verified.valid ||
    !(await isDeletionNonceCurrent(verified.userId, verified.nonce))
  ) {
    return (
      <Message title={t("invalidTitle")} body={t("invalidMessage")}>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          {t("home")}
        </Link>
      </Message>
    );
  }

  const user = await getUser();
  if (user && user.id !== verified.userId) {
    return (
      <Message title={t("wrongAccountTitle")} body={t("wrongAccountMessage")}>
        <Link href="/konto" className={buttonVariants({ variant: "outline" })}>
          {t("toAccount")}
        </Link>
      </Message>
    );
  }

  const errorKey = ERROR_KEYS.includes(errorParam) ? errorParam : null;

  return (
    <Message title={t("title")} body={t("message")}>
      {errorKey && (
        <p role="alert" className="text-danger-text mb-4 text-sm">
          {t(
            `errors.${errorKey as "sole_admin" | "generic" | "invalid" | "wrong_account"}`,
          )}
        </p>
      )}
      <form action={confirmAccountDeletion} className="flex gap-3">
        <input type="hidden" name="token" value={token} />
        <ConfirmSubmitButton
          label={t("confirm")}
          pendingLabel={t("confirming")}
        />
        <Link
          href={user ? "/konto" : "/"}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("cancel")}
        </Link>
      </form>
    </Message>
  );
}

function Message({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">{title}</h1>
      <p className="text-muted-foreground mb-6 text-sm">{body}</p>
      {children}
    </div>
  );
}
