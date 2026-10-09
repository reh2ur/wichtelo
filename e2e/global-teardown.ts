import { BASE_URL, testApiHeaders } from "./helpers";

export default async function globalTeardown() {
  await fetch(`${BASE_URL}/api/test/cleanup`, {
    method: "DELETE",
    headers: testApiHeaders(),
  }).catch(() => {});
}
