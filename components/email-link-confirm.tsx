import { Button } from "@/components/ui/button";

/**
 * "Confirm sign-in" step behind the emailed button. Rendering is a plain GET
 * and consumes nothing; only submitting the form (POST server action) uses
 * the one-time token, so link scanners that prefetch the URL can't burn it.
 */
export function EmailLinkConfirm({
  title,
  message,
  submitLabel,
  tokenHash,
  action,
}: {
  title: string;
  message: string;
  submitLabel: string;
  tokenHash: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">{title}</h1>
      <p className="text-muted-foreground mb-6 text-sm">{message}</p>
      <form action={action}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <Button type="submit">{submitLabel}</Button>
      </form>
    </div>
  );
}
