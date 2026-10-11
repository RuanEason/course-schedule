/**
 * Class identity, as expressed in URLs.
 *
 * One Next.js app serves every class. A class is addressed by a path prefix
 * (`/class2`, `/class3`), which `proxy.ts` strips before the request reaches
 * the route tree and turns into the internal `x-class-schedule-class` header.
 *
 * Keep this module free of `server-only` and of any database access: it is pure
 * path arithmetic, it runs inside Proxy, and it is unit tested directly.
 */

/** The historical single-schedule id, kept so upgrades change nothing. */
export const DEFAULT_CLASS_ID = "default";

/** Prefix that marks a request as belonging to a specific class. */
export const CLASS_PATH_PREFIX = "/class";

/**
 * Internal header carrying the resolved class from Proxy to the route handlers.
 *
 * This is a trust boundary: an outside caller must never be able to set it.
 * The reverse proxy in front of the app clears it on the way in (see the Nginx
 * sample in the README) and `proxy.ts` writes it afterwards. Even so, every
 * consumer re-validates the class against the database and the caller's
 * permissions, so a forged value can at worst name a class the caller may
 * already read.
 */
export const CLASS_HEADER = "x-class-schedule-class";

/**
 * A class slug is restrictive on purpose, and the part after the `class`
 * keyword must START WITH A DIGIT.
 *
 * That single rule is what keeps `/classroom`, `/classes` and
 * `/class-name.json` out: they all begin with the prefix but are ordinary
 * paths, and treating them as classes would hide real routes behind a 404.
 * Real class ids look like `class1`, `class2`, `class12`.
 */
const CLASS_KEYWORD = "class";
const CLASS_SLUG_PATTERN = /^class\d[A-Za-z0-9_-]{0,31}$/;

/** Roles a path segment can play once the class prefix has been removed. */
export interface ClassPathMatch {
  /** The class slug, e.g. `class2`. */
  slug: string;
  /** The remaining path, always beginning with `/`. */
  rest: string;
}

export function isValidClassSlug(value: unknown): value is string {
  return typeof value === "string" && CLASS_SLUG_PATTERN.test(value);
}

/**
 * Source string for callers that need to embed the rule in their own grammar
 * (a Zod schema, an HTML pattern attribute) rather than call the validator.
 * Exported so the rule lives in exactly one place.
 */
export const CLASS_SLUG_SOURCE = CLASS_SLUG_PATTERN.source;

/**
 * Splits `/class2/editor` into `{ slug: "class2", rest: "/editor" }`.
 *
 * Returns null for anything that is not an exact class segment, including
 * `/class2x`, `/classroom`, bare `/class`, and `/foo/class2`.
 */
export function parseClassPath(pathname: string): ClassPathMatch | null {
  if (!pathname.startsWith(CLASS_PATH_PREFIX)) return null;
  // `CLASS_PATH_PREFIX` is `/class`, so the remainder already excludes the
  // literal keyword: `/class2/editor` -> `2/editor`, `/classroom` -> `room`.
  const withoutPrefix = pathname.slice(CLASS_PATH_PREFIX.length);
  if (withoutPrefix === "") return null;

  const separatorIndex = withoutPrefix.indexOf("/");
  const suffix = separatorIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, separatorIndex);
  if (suffix === "") return null;

  const slug = `${CLASS_KEYWORD}${suffix}`;
  if (!isValidClassSlug(slug)) return null;

  const rest = separatorIndex === -1 ? "/" : withoutPrefix.slice(separatorIndex);
  return { slug, rest: rest || "/" };
}

/** `/class2/api/schedule` -> `{ slug: "class2", rest: "/api/schedule" }` handling is the caller's job. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * Paths that Proxy must leave alone.
 *
 * `_next` carries the build's own assets and RSC payloads. `/api/**` is served
 * without a class prefix by design: keeping every write on an unprefixed,
 * same-origin path preserves the existing `APP_ORIGIN` check exactly, and the
 * per-class API paths are rewritten into these by the caller-facing route tree.
 * The bare `/config.json` is what the Electron client has always fetched.
 */
export function isReservedPath(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/__nextjs")) return true;
  if (pathname === "/favicon.ico" || pathname === "/robots.txt" || pathname === "/sitemap.xml") return true;
  return false;
}

/** Builds the public prefix for a class. The default class has no prefix on public routes. */
export function classBasePath(classId: string): string {
  return classId === DEFAULT_CLASS_ID ? "" : `/${classId}`;
}
