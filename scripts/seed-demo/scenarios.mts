// Demo scenarios for staging/local (`pnpm seed:demo`). Pure data, no I/O —
// invariants checked by scenarios.test.ts. Everything here is fictional.

export const DEMO_EMAIL_DOMAIN = "test.local";
export const DEMO_SLUG_PREFIX = "demo-";

export type DemoUser = {
  alias: string;
  email: string;
  firstName: string;
  lastName: string;
};

export type DemoGroup = {
  slug: string;
  name: string;
  state: "open" | "drawn";
  budgetHint: string | null;
  note: string | null;
  /** First entry = admin; rest participants. */
  members: string[];
};

export type DemoWish = {
  owner: string;
  title: string;
  url: string | null;
  note: string | null;
  priceEstimate: number | null;
  /** Group slug, or null = unassigned. Owner must be a member. */
  group: string | null;
  received: boolean;
};

const user = (alias: string, firstName: string): DemoUser => ({
  alias,
  email: `demo-${alias}@${DEMO_EMAIL_DOMAIN}`,
  firstName,
  lastName: "Demo",
});

export const DEMO_USERS: DemoUser[] = [
  user("alice", "Alice"), // admin of both groups, 40 wishes
  user("bob", "Bob"), // member of both groups, a few wishes
  user("carla", "Carla"), // member of both groups, few wishes
  user("dana", "Dana"), // no group, empty wish list
  user("erik", "Erik"), // no group, wishes only unassigned
];

export const DEMO_GROUPS: DemoGroup[] = [
  {
    slug: `${DEMO_SLUG_PREFIX}weihnachtsfeier-offen`,
    name: "Demo Weihnachtsfeier (offen)",
    state: "open",
    budgetHint: "ca. 20 €",
    note: "Seed-Daten, jederzeit überschreibbar.",
    members: ["alice", "bob", "carla"],
  },
  {
    slug: `${DEMO_SLUG_PREFIX}buero-gezogen`,
    name: "Demo Büro (gezogen)",
    state: "drawn",
    budgetHint: "ca. 15 €",
    note: null,
    members: ["alice", "bob", "carla"],
  },
];

const OPEN = DEMO_GROUPS[0].slug;
const DRAWN = DEMO_GROUPS[1].slug;

const w = (
  owner: string,
  title: string,
  extra: Partial<Omit<DemoWish, "owner" | "title">> = {},
): DemoWish => ({
  owner,
  title,
  url: null,
  note: null,
  priceEstimate: null,
  group: null,
  received: false,
  ...extra,
});

const aliceHandwritten: DemoWish[] = [
  w("alice", "Kaffeemühle (Handmühle)", {
    url: "https://example.com/kaffeemuehle",
    note: "Gerne aus Keramik, nicht Plastik.",
    priceEstimate: 39.9,
    group: OPEN,
  }),
  w("alice", "Wollsocken", { priceEstimate: 14.5, group: OPEN }),
  w("alice", "Kochbuch Levante", { priceEstimate: 29, group: DRAWN }),
  w("alice", "Gutschein Kletterhalle", {
    url: "example.com/klettern",
    group: DRAWN,
  }),
  w("alice", "Kerzen (Bienenwachs)", { priceEstimate: 9.9 }),
  w("alice", "Brettspiel für zwei", {
    note: "Kooperativ, kein Würfelglück.",
    priceEstimate: 24.9,
  }),
  w("alice", "Thermosflasche", { priceEstimate: 22, received: true }),
  w("alice", "Notizbuch A5", {
    priceEstimate: 12,
    group: OPEN,
    received: true,
  }),
  w("alice", "Pflanzen-Setzlinge", { note: "Tomate, Basilikum." }),
  w("alice", "Fahrradklingel", { priceEstimate: 8.5, received: true }),
  w("alice", "Teeset", { priceEstimate: 18, group: DRAWN }),
  w(
    "alice",
    "Sehr langer Titel zum Testen des Umbruchs in der Liste ".repeat(3),
  ),
];

// Fill up to 40 wishes (pagination-free list, filter/search stress).
const aliceGenerated: DemoWish[] = Array.from({ length: 28 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return w("alice", `Demo-Wunsch ${n}`, {
    group: [null, OPEN, DRAWN][i % 3],
    received: i % 4 === 3,
    priceEstimate: i % 2 === 0 ? 5 + i : null,
  });
});

export const DEMO_WISHES: DemoWish[] = [
  ...aliceHandwritten,
  ...aliceGenerated,
  w("bob", "Laufschuhe Größe 44", { priceEstimate: 90, group: OPEN }),
  w("bob", "Powerbank", { priceEstimate: 25, group: DRAWN }),
  w("bob", "Wanderkarte", { priceEstimate: 11.9 }),
  w("bob", "Vinyl-Platte", { received: true }),
  w("carla", "Pinsel-Set", { priceEstimate: 17, group: OPEN }),
  w("carla", "Aquarellblock", { group: DRAWN, note: "Mind. 300 g/m²." }),
  w("carla", "Schal", { priceEstimate: 29.95 }),
  w("erik", "Schachuhr", { priceEstimate: 35 }),
  w("erik", "Taschenlampe"),
  w("erik", "Angelhaken-Set", { received: true }),
];
