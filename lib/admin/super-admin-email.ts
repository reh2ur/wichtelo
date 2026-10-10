/**
 * Case-insensitive match against `SUPER_ADMIN_EMAIL`. Emails are
 * case-insensitive in practice and GoTrue lowercases stored addresses, so a
 * mixed-case env value must not lock the operator out. Unset/blank env never
 * matches anything.
 */
export function isSuperAdminEmail(
  email: string | null | undefined,
  configured: string | undefined = process.env.SUPER_ADMIN_EMAIL,
): boolean {
  const expected = configured?.trim().toLowerCase();
  const actual = email?.trim().toLowerCase();
  return !!expected && !!actual && expected === actual;
}
