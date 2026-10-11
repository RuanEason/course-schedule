import { NextResponse, type NextRequest } from "next/server";

import {
  CLASS_HEADER,
  DEFAULT_CLASS_ID,
  isReservedPath,
  parseClassPath,
} from "@/lib/schedule/classes";

/**
 * Class routing.
 *
 * Every request carries the class it belongs to. The shapes that reach us:
 *
 *   /class2              -> /class2              (+ class header)  [class] page tree
 *   /class2/editor       -> /class2/editor       (+ class header)  [class] page tree
 *   /class2/config.json  -> /class2/config.json  (+ class header)  [class] route handler
 *   /class2/api/x        -> /class2/api/x        (+ class header)  [class] route handler
 *   /config.json         -> /config.json         (+ default class) legacy handler
 *   /api/x               -> /api/x               (+ default class) legacy handler
 *   :3002/config.json    -> Nginx maps the port onto /class2/config.json
 *
 * The class is published to the route tree through `CLASS_HEADER` rather than a
 * cookie, so a browser tab viewing one class cannot leak the choice into a
 * request for another, and so the Electron client (which owns no cookie jar)
 * still lands on the right class.
 *
 * Note what is deliberately NOT rewritten: a class request stays under its own
 * `[class]` segment. The unprefixed `/api/**` and `/config.json` routes serve the
 * default class (they exist for the historical single-class deployment) and
 * would otherwise swallow every class's requests.
 *
 * Requests without a class prefix fall back to `CLASS_CONFIG_SLUG`, defaulting
 * to the historical single schedule, which keeps the deployed client address
 * working unchanged.
 */

function rewriteTo(request: NextRequest, classId: string, pathname: string, search: string) {
  const headers = new Headers(request.headers);
  // Overwrite unconditionally: the value is server-derived and must never echo
  // a caller-supplied header.
  headers.set(CLASS_HEADER, classId);
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  return NextResponse.rewrite(url, { request: { headers } });
}

function fallbackClassId(): string {
  const configured = process.env.CLASS_CONFIG_SLUG?.trim();
  return configured || DEFAULT_CLASS_ID;
}

function splitQuery(path: string): [string, string] {
  const index = path.indexOf("?");
  if (index === -1) return [path, ""];
  return [path.slice(0, index), path.slice(index + 1)];
}

function mergeQuery(original: string, fromRest: string): string {
  const params = new URLSearchParams(original.startsWith("?") ? original.slice(1) : original);
  if (fromRest) {
    for (const [key, value] of new URLSearchParams(fromRest)) params.set(key, value);
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

/**
 * Nests a class path back under its class segment.
 *
 * CRITICAL: `/class2/api/schedule` must NOT be rewritten to `/api/schedule` —
 * the unprefixed API routes serve the *default* class and would take precedence,
 * silently handing class 2's editor class 1's timetable. Prefixing again routes
 * the request into the dynamic `[class]` tree, which knows its own class.
 */
function pathForClassTree(restPath: string, slug: string): string {
  if (restPath === "/api" || restPath.startsWith("/api/")) return `/${slug}${restPath}`;
  if (restPath === "/config.json") return `/${slug}/config.json`;
  return restPath;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isReservedPath(pathname)) return NextResponse.next();

  const match = parseClassPath(pathname);
  if (match) {
    // `/class2/api/x` and `/class2/config.json` must resolve against the class
    // tree. Rewriting them to the bare `/api/x` and `/config.json` would hit the
    // *default* class's handlers, because those unprefixed routes exist for the
    // historical entry point and win over the dynamic `[class]` segment.
    const [restPath, restQuery] = splitQuery(match.rest);
    return rewriteTo(
      request,
      match.slug,
      `${pathForClassTree(restPath, match.slug)}${restQuery}`,
      mergeQuery(request.nextUrl.search, restQuery),
    );
  }

  // No class prefix: this is the legacy entry point. Attribute it to the
  // configured default class instead of leaving the header unset, so handlers
  // have a single code path and never have to guess.
  return rewriteTo(request, fallbackClassId(), pathname, request.nextUrl.search);
}

export const config = {
  // Static assets need no class context. `/api/**` is excluded because the
  // unprefixed API routes serve the default class; their per-class counterparts
  // live at `/classN/api/**`, which this matcher does allow through (only the
  // bare `/api/` prefix is skipped, not `classN/api/`).
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
