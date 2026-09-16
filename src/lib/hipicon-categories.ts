import categoriesJson from "./data/hipicon-categories.json";

export type HipiconCategory = {
  id: string;
  path: string;
};

export const BUNDLED_HIPICON_CATEGORIES = categoriesJson as HipiconCategory[];

/** @deprecated use BUNDLED_HIPICON_CATEGORIES or getActiveCategories() */
export const HIPICON_CATEGORIES = BUNDLED_HIPICON_CATEGORIES;

type CategoryIndexes = {
  all: HipiconCategory[];
  bags: HipiconCategory[];
  byId: Map<string, HipiconCategory>;
  byPath: Map<string, HipiconCategory>;
};

function buildIndexes(cats: HipiconCategory[]): CategoryIndexes {
  const all = cats.map((c) => ({
    id: String(c.id).trim(),
    path: String(c.path).trim(),
  }));
  return {
    all,
    bags: all.filter((c) => /çanta/i.test(c.path)),
    byId: new Map(all.map((c) => [c.id, c])),
    byPath: new Map(all.map((c) => [c.path.toLocaleLowerCase("tr-TR"), c])),
  };
}

let indexes = buildIndexes(BUNDLED_HIPICON_CATEGORIES);
let liveApplied = false;

/** Hipicon API / cache ile gelen listeyi aktif havuza uygular. */
export function applyLiveCategories(
  cats: HipiconCategory[] | null | undefined,
): void {
  if (cats && cats.length > 0) {
    indexes = buildIndexes(cats);
    liveApplied = true;
    return;
  }
  indexes = buildIndexes(BUNDLED_HIPICON_CATEGORIES);
  liveApplied = false;
}

export function hasLiveCategories(): boolean {
  return liveApplied;
}

export function getActiveCategories(): HipiconCategory[] {
  return indexes.all;
}

export function getBagCategories(): HipiconCategory[] {
  return indexes.bags;
}

export function categoryById(id: string | null | undefined): HipiconCategory | null {
  if (!id) return null;
  return indexes.byId.get(String(id).trim()) ?? null;
}

export function categoryByPath(
  path: string | null | undefined,
): HipiconCategory | null {
  if (!path?.trim()) return null;
  return indexes.byPath.get(path.trim().toLocaleLowerCase("tr-TR")) ?? null;
}

export function searchCategories(
  query: string,
  limit = 40,
  pool: HipiconCategory[] = indexes.all,
): HipiconCategory[] {
  return searchInPool(pool, query, limit);
}

/** Yalnızca path’inde “çanta” geçen Hipicon kategorileri. */
export const BAG_HIPICON_CATEGORIES = BUNDLED_HIPICON_CATEGORIES.filter((c) =>
  /çanta/i.test(c.path),
);

export function searchBagCategories(
  query: string,
  limit = 40,
  pool: HipiconCategory[] = indexes.bags,
): HipiconCategory[] {
  return searchInPool(pool, query, limit);
}

function searchInPool(
  pool: HipiconCategory[],
  query: string,
  limit: number,
): HipiconCategory[] {
  const q = query.trim().toLocaleLowerCase("tr-TR");
  if (!q) return pool.slice(0, limit);
  const scored: Array<{ c: HipiconCategory; score: number }> = [];
  for (const c of pool) {
    const p = c.path.toLocaleLowerCase("tr-TR");
    if (c.id === q) {
      scored.push({ c, score: 1000 });
      continue;
    }
    if (!p.includes(q) && !c.id.includes(q)) continue;
    let score = 0;
    if (p.startsWith(q)) score += 50;
    if (p.split(">").pop()?.trim().startsWith(q)) score += 30;
    score += 20 - Math.min(20, p.indexOf(q));
    scored.push({ c, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c);
}

/** LoadingBag varsayılanı — sırt çantası. */
export const DEFAULT_HIPICON_CATEGORY: HipiconCategory = {
  id: "571",
  path: "Erkek > Çanta > Sırt Çantası",
};

export type CategoryRule = {
  /** product_type / title / tags / handle içinde aranır (regex veya düz metin) */
  pattern: string;
  categoryId: string;
};

export function resolveHipiconCategory(options: {
  defaultId: string;
  rules: CategoryRule[];
  productType?: string | null;
  title?: string | null;
  handle?: string | null;
  tags?: string[];
}): HipiconCategory {
  const haystack = [
    options.productType ?? "",
    options.title ?? "",
    options.handle ?? "",
    ...(options.tags ?? []),
  ]
    .join(" · ")
    .toLocaleLowerCase("tr-TR");

  for (const rule of options.rules) {
    const raw = rule.pattern.trim();
    if (!raw) continue;
    let matched = false;
    try {
      matched = new RegExp(raw, "i").test(haystack);
    } catch {
      matched = haystack.includes(raw.toLocaleLowerCase("tr-TR"));
    }
    if (!matched) continue;
    const hit = categoryById(rule.categoryId);
    if (hit) return hit;
  }

  return categoryById(options.defaultId) ?? DEFAULT_HIPICON_CATEGORY;
}

/** Hipicon path veya Shopify metninde çanta/bag sinyali. */
export function isBagCategoryPath(path: string): boolean {
  return /çanta/i.test(path);
}

export function isBagVariant(options: {
  defaultId: string;
  rules: CategoryRule[];
  productType?: string | null;
  title?: string | null;
  handle?: string | null;
  tags?: string[];
}): boolean {
  const cat = resolveHipiconCategory(options);
  if (isBagCategoryPath(cat.path)) return true;
  const hay = [
    options.productType ?? "",
    options.title ?? "",
    options.handle ?? "",
    ...(options.tags ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase("tr-TR");
  return /bag|backpack|çanta|duffel|weekender|belt|clutch|pouch|laptop/.test(
    hay,
  );
}

/** LoadingBag için hazır kurallar — Ayarlar’da düzenlenebilir. */
export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  {
    pattern: "belt|bel.?çanta|waist|daily belt",
    categoryId: "891",
  },
  {
    pattern: "laptop|tech bag|tablet",
    categoryId: "573",
  },
  {
    pattern: "cooler|seyahat|duffel|weekender|spor çanta",
    categoryId: "574",
  },
  {
    pattern: "flat bag|clutch|el çanta|pouch|accessories? set|cüzdan|card holder|coin",
    categoryId: "371",
  },
  {
    pattern: "backpack|sırt|rolltop|urban|midi",
    categoryId: "571",
  },
];
