import type { HipiconCategory } from "../../lib/hipicon-categories";

/** Hipicon SPA şu an bunu kullanıyor; dinamik çözülemezse yedek. */
const FALLBACK_CATEGORY_TREE_ROOT_ID = "114";
const ROOT_ID_SESSION_KEY = "hipistock.categoryTreeRootId";
const API_BASE = "https://bo-api.hipicon.com/designer-api/v1";

const ROOT_ID_IN_TREE_URL = /\/category\/category-tree\/(\d+)/i;
const ROOT_ID_IN_BUNDLE =
  /useListCategoryTree\)\(\s*["'](\d+)["']|\/category\/category-tree\/(\d+)/;

type TreeCategory = {
  id?: number | string;
  name?: string;
  breadcrumb?: string | string[] | null;
};

type TreeNode = {
  category?: TreeCategory | null;
  subCategories?: TreeNode[] | null;
};

function authToken(): string {
  const token = localStorage.getItem("x-auth-token")?.trim();
  if (!token) {
    throw new Error("Hipicon oturumu yok — satıcı paneline giriş yapın");
  }
  return token;
}

function cacheRootId(id: string) {
  try {
    sessionStorage.setItem(ROOT_ID_SESSION_KEY, id);
  } catch {
    /* ignore */
  }
}

function rootIdFromSession(): string | null {
  try {
    const cached = sessionStorage.getItem(ROOT_ID_SESSION_KEY)?.trim();
    if (cached && /^\d+$/.test(cached)) return cached;
  } catch {
    /* ignore */
  }
  return null;
}

function rootIdFromPerformance(): string | null {
  try {
    for (const entry of performance.getEntriesByType("resource")) {
      const m = String(
        (entry as PerformanceResourceTiming).name,
      ).match(ROOT_ID_IN_TREE_URL);
      if (m?.[1]) return m[1];
    }
  } catch {
    /* ignore */
  }
  return null;
}

function rootIdFromLocalStorage(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const val = localStorage.getItem(key);
      if (!val || val.length > 400_000) continue;
      if (
        !key.includes("category-tree") &&
        !val.includes("category-tree")
      ) {
        continue;
      }
      const m = val.match(ROOT_ID_IN_TREE_URL);
      if (m?.[1]) return m[1];
    }
  } catch {
    /* ignore */
  }
  return null;
}

function sameOriginScriptUrls(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    try {
      const u = new URL(raw, location.href);
      if (u.origin !== location.origin) return;
      if (!u.pathname.includes("/_next/")) return;
      if (!u.pathname.endsWith(".js")) return;
      if (seen.has(u.href)) return;
      seen.add(u.href);
      out.push(u.href);
    } catch {
      /* ignore */
    }
  };

  try {
    for (const entry of performance.getEntriesByType("resource")) {
      push((entry as PerformanceResourceTiming).name);
    }
  } catch {
    /* ignore */
  }

  for (const el of document.querySelectorAll("script[src]")) {
    const src = (el as HTMLScriptElement).src;
    if (src) push(src);
  }

  return out;
}

async function rootIdFromPageScripts(): Promise<string | null> {
  const scripts = sameOriginScriptUrls();
  const batchSize = 8;
  for (let i = 0; i < scripts.length; i += batchSize) {
    const batch = scripts.slice(i, i + batchSize);
    const found = await Promise.all(
      batch.map(async (src) => {
        try {
          const res = await fetch(src, { cache: "force-cache" });
          if (!res.ok) return null;
          const text = await res.text();
          const m = text.match(ROOT_ID_IN_BUNDLE);
          return m?.[1] || m?.[2] || null;
        } catch {
          return null;
        }
      }),
    );
    const hit = found.find((id): id is string => !!id);
    if (hit) return hit;
  }
  return null;
}

/** SPA’nın kullandığı kategori ağacı kök ID’sini sayfadan çözer. */
export async function resolveCategoryTreeRootId(): Promise<string> {
  const fromSession = rootIdFromSession();
  if (fromSession) return fromSession;

  const fromPerf = rootIdFromPerformance();
  if (fromPerf) {
    cacheRootId(fromPerf);
    return fromPerf;
  }

  const fromLs = rootIdFromLocalStorage();
  if (fromLs) {
    cacheRootId(fromLs);
    return fromLs;
  }

  const fromScripts = await rootIdFromPageScripts();
  if (fromScripts) {
    cacheRootId(fromScripts);
    return fromScripts;
  }

  return FALLBACK_CATEGORY_TREE_ROOT_ID;
}

function breadcrumbPath(cat: TreeCategory, fallback: string[]): string {
  const raw = cat.breadcrumb;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && raw.length) {
    return raw.map((p) => String(p).trim()).filter(Boolean).join(" > ");
  }
  return fallback.filter(Boolean).join(" > ");
}

function flattenLeaves(
  nodes: TreeNode[] | null | undefined,
  parentNames: string[],
  out: HipiconCategory[],
  seen: Set<string>,
) {
  if (!nodes?.length) return;
  for (const node of nodes) {
    const cat = node.category;
    if (!cat) continue;
    const id = String(cat.id ?? "").trim();
    const name = String(cat.name ?? "").trim();
    const names = name ? [...parentNames, name] : parentNames;
    const children = node.subCategories ?? [];
    if (children.length > 0) {
      flattenLeaves(children, names, out, seen);
      continue;
    }
    if (!id) continue;
    const path = breadcrumbPath(cat, names);
    if (!path || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, path });
  }
}

function unwrapTree(payload: unknown): TreeNode {
  if (!payload || typeof payload !== "object") {
    throw new Error("Kategori ağacı boş döndü");
  }
  const root = payload as TreeNode & { data?: unknown };
  if (root.subCategories || root.category) return root;
  if (root.data && typeof root.data === "object") {
    return root.data as TreeNode;
  }
  throw new Error("Kategori ağacı çözümlenemedi");
}

/** Satıcı paneli oturumuyla Hipicon kategori listesini çeker. */
export async function fetchHipiconCategoryList(): Promise<HipiconCategory[]> {
  const token = authToken();
  const rootId = await resolveCategoryTreeRootId();
  const res = await fetch(
    `${API_BASE}/category/category-tree/${rootId}`,
    {
      method: "GET",
      headers: {
        "X-Channel": "WEB",
        "Content-Type": "application/json",
        "auth-token": token,
      },
    },
  );

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err = body as { error?: { message?: string } } | null;
    throw new Error(
      err?.error?.message || `Kategori API hatası (HTTP ${res.status})`,
    );
  }

  const data =
    body && typeof body === "object" && "data" in body
      ? (body as { data: unknown }).data
      : body;
  const tree = unwrapTree(data);
  const out: HipiconCategory[] = [];
  flattenLeaves(tree.subCategories, [], out, new Set());
  out.sort((a, b) => a.path.localeCompare(b.path, "tr"));
  if (!out.length) {
    throw new Error("Hipicon kategori listesi boş");
  }
  return out;
}
