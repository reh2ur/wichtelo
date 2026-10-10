import { getMessages } from "next-intl/server";
import { safeNext } from "@/lib/safe-next";
import { SignInProvider, AuthFormClient } from "./auth-form-client";

export async function AuthForm({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const messages = await getMessages();
  const params = await searchParams;
  // Validated here and again in the actions: never trust the hidden field.
  const next = safeNext(params.next) ?? "";
  return (
    <SignInProvider messages={{ signIn: messages.signIn }}>
      <AuthFormClient next={next} />
    </SignInProvider>
  );
}
