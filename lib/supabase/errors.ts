/** Postgres unique_violation, surfaced by PostgREST as `error.code`. */
export function isUniqueViolation(
  error: { code?: string } | null | undefined,
): boolean {
  return error?.code === "23505";
}
