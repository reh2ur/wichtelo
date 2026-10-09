import { getMessages } from "next-intl/server";
import { SignInProvider, AuthFormClient } from "./auth-form-client";

export async function AuthForm() {
  const messages = await getMessages();
  return (
    <SignInProvider messages={{ signIn: messages.signIn }}>
      <AuthFormClient />
    </SignInProvider>
  );
}
