export function storeHandleFromLocation(): string | null {
  const match = location.pathname.match(/\/store\/([^/]+)/i);
  return match?.[1] ?? null;
}

export function csrfToken(): string | null {
  const meta = document.querySelector(
    'meta[name="csrf-token"], meta[name="csrf_token"]',
  );
  const fromMeta = meta?.getAttribute("content")?.trim();
  if (fromMeta) return fromMeta;

  const csrfCookie = document.cookie.match(
    /(?:^|;\s*)(?:csrf_token|XSRF-TOKEN|_csrf)=([^;]+)/i,
  );
  if (csrfCookie?.[1]) {
    try {
      return decodeURIComponent(csrfCookie[1]);
    } catch {
      return csrfCookie[1];
    }
  }
  return null;
}

/** Admin SPA bazen bearer / session token’ı script veya meta’da tutar. */
export function pageSessionToken(): string | null {
  const meta = document.querySelector(
    'meta[name="shopify-access-token"], meta[name="jwt-token"]',
  );
  const fromMeta = meta?.getAttribute("content")?.trim();
  if (fromMeta) return fromMeta;

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!/token|session|auth/i.test(key)) continue;
      const raw = localStorage.getItem(key);
      if (!raw || raw.length < 20 || raw.length > 4000) continue;
      if (raw.startsWith("eyJ") || raw.startsWith("shpat_") || raw.startsWith("shpca_")) {
        return raw.replace(/^"|"$/g, "");
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const k of ["accessToken", "access_token", "token", "jwt"]) {
          const v = parsed[k];
          if (typeof v === "string" && v.length > 20) return v;
        }
      } catch {
        /* not json */
      }
    }
  } catch {
    /* storage blocked */
  }
  return null;
}

export function sessionHeaders(
  forPost: boolean,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-shopify-web-force-proxy": "1",
    "x-requested-with": "XMLHttpRequest",
    ...extra,
  };
  if (forPost) {
    headers["content-type"] = "application/json";
    headers["apollo-require-preflight"] = "true";
  }
  const csrf = csrfToken();
  if (csrf) {
    headers["x-csrf-token"] = csrf;
    headers["x-shopify-csrf"] = csrf;
  }
  const token = pageSessionToken();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function graphql<T>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>,
  operationName?: string,
): Promise<T> {
  const body: Record<string, unknown> = { query, variables };
  if (operationName) body.operationName = operationName;
  const res = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: sessionHeaders(true),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GraphQL ${res.status}: ${text.slice(0, 160)}`);
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new Error("GraphQL data boş");
  return json.data;
}

export function candidateEndpoints(storeHandle: string): string[] {
  const origin = location.origin;
  return [
    `${origin}/api/shopify/${storeHandle}/graphql`,
    `${origin}/api/shopify/${storeHandle}/graphql.json`,
    `${origin}/store/${storeHandle}/internal/web/graphql/core`,
    `${origin}/store/${storeHandle}/api/2025-01/graphql.json`,
    `${origin}/store/${storeHandle}/api/2024-10/graphql.json`,
  ];
}

export async function pickWorkingEndpoint(
  storeHandle: string,
): Promise<string> {
  const probe = `query HipistokProbe { shop { name } }`;
  let lastError: Error | null = null;
  for (const endpoint of candidateEndpoints(storeHandle)) {
    try {
      await graphql<{ shop: { name: string } }>(
        endpoint,
        probe,
        undefined,
        "HipistokProbe",
      );
      return endpoint;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("Shopify Admin GraphQL endpoint bulunamadı");
}
