import { cache } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const getUser = cache(async () => {
  // Explicit dynamic boundary: Supabase's auth client calls Date.now()
  // internally (session expiry check) as part of an unawaited microtask
  // fired during client construction. Under Cache Components, that call
  // isn't reliably tracked as happening after cookies()'s dynamic marker,
  // so it can be misdetected as an unstable prerender access. `connection()`
  // forces this whole cached lookup into the dynamic scope up front.
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
