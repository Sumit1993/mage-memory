import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { exists, isUnder, looksLikeHub } from "./path-guards.js";

// ─── ADR-0043 — a hub is addressed by its remote, located by derivation ────
//
// Ground truth is git's OWN documented URL grammar (`git help clone`, section
// GIT URLS), not an inferred pattern:
//
//   ssh://[user@]host.xz[:port]/path/to/repo.git/
//   git://host.xz[:port]/path/to/repo.git/
//   http[s]://host.xz[:port]/path/to/repo.git/
//   ftp[s]://host.xz[:port]/path/to/repo.git/   (fetch-only, deprecated — rejected)
//
//   scp-like: [user@]host.xz:path/to/repo.git/
//     "This syntax is only recognized if there are no slashes before the
//     first colon." — so a bare `indexOf(":")` misclassifies `./foo:bar`.
//     It has NO port field: everything after the colon is the path.
//
//   ~username expansion: ssh://…/~[user]/path, git://…/~[user]/path,
//     [user@]host.xz:/~[user]/path — rejected (would collide with the
//     home-relative grant form, ADR-0043 §8).
//
//   local: /path/to/repo.git, file:///path/to/repo.git — rejected (a local
//     hub is addressed `local://<name>` per ADR-0044, never by path).

export class HubUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubUrlError";
  }
}

/** The canonical result of {@link canonicalizeHubRepo}. */
export interface CanonicalHubRepo {
  /** Lowercased host, with a non-default port joined as `host_port`. */
  host: string;
  /** Lowercased path components, one directory segment each. Never empty. */
  segments: string[];
  /** `host + "/" + segments.join("/")` — the injective identity of the hub. */
  key: string;
}

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;
const DEFAULT_PORTS: Record<string, number> = { ssh: 22, git: 9418, http: 80, https: 443 };
const ACCEPTED_SCHEMES = new Set(["ssh", "git", "http", "https"]);
const FETCH_ONLY_SCHEMES = new Set(["ftp", "ftps"]);

/**
 * Strip credentials from a git URL before it ever reaches a log line or error
 * message. A remote may legitimately embed a token
 * (`https://x-access-token:ghp_…@github.com/o/r.git`), and quoting it verbatim
 * leaks that token into terminals, CI logs, and issue reports. Tolerant of
 * unparseable input (never throws) — every {@link HubUrlError} message routes
 * through this FIRST, including for the very input that failed to parse.
 */
export function redactUrl(url: string): string {
  const schemeMatch = SCHEME_RE.exec(url);
  if (schemeMatch) {
    const prefix = schemeMatch[0];
    const rest = url.slice(prefix.length);
    const slashIdx = rest.indexOf("/");
    const authority = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    const tail = slashIdx === -1 ? "" : rest.slice(slashIdx);
    const atIdx = authority.lastIndexOf("@");
    const redactedAuthority = atIdx === -1 ? authority : authority.slice(atIdx + 1);
    return `${prefix}${redactedAuthority}${tail}`;
  }

  // scp-like / local-path shaped input: only strip userinfo when the scp-like
  // "no slashes before the first colon" rule actually applies — otherwise
  // there is no authority component to redact.
  const firstColon = url.indexOf(":");
  const firstSlash = url.indexOf("/");
  const looksLikeScp = firstColon !== -1 && (firstSlash === -1 || firstColon < firstSlash);
  if (looksLikeScp) {
    const authority = url.slice(0, firstColon);
    const tail = url.slice(firstColon);
    const atIdx = authority.lastIndexOf("@");
    const redactedAuthority = atIdx === -1 ? authority : authority.slice(atIdx + 1);
    return `${redactedAuthority}${tail}`;
  }
  return url;
}

function fail(rule: string, original: string): never {
  throw new HubUrlError(`${rule}: ${redactUrl(original)}`);
}

/**
 * Parse a git remote URL into its canonical `{ host, segments, key }` — the
 * ONLY thing a hub's local path is ever derived from ({@link deriveHubPath}).
 * Accepts exactly the forms git itself accepts (see the module doc above);
 * rejects everything else with a {@link HubUrlError} naming which rule fired.
 * Never percent-decodes (a literal `%2e%2e` must never become `..`).
 */
export function canonicalizeHubRepo(url: string): CanonicalHubRepo {
  const trimmed = url.trim();
  if (!trimmed) fail("Hub URL is empty", url);

  const schemeMatch = SCHEME_RE.exec(trimmed);
  if (schemeMatch) {
    const scheme = (schemeMatch[1] ?? "").toLowerCase();
    if (FETCH_ONLY_SCHEMES.has(scheme)) {
      fail(`${scheme}:// is fetch-only and deprecated by git — not accepted as a hub address`, trimmed);
    }
    if (scheme === "file") {
      fail("file:// is a local path — a local hub is addressed local://<name> (ADR-0044), never by path", trimmed);
    }
    if (!ACCEPTED_SCHEMES.has(scheme)) {
      fail(`Unrecognized git URL scheme '${scheme}://'`, trimmed);
    }
    const rest = trimmed.slice(schemeMatch[0].length);
    const slashIdx = rest.indexOf("/");
    const authority = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    const pathPart = slashIdx === -1 ? "" : rest.slice(slashIdx + 1);
    return finishCanonicalize(scheme, authority, pathPart, trimmed);
  }

  // No recognized scheme. git: "This syntax [scp-like] is only recognized if
  // there are no slashes before the first colon. This helps differentiate a
  // local path that contains a colon" (git's own example: `./foo:bar`). A bare
  // `indexOf(":")` — ignoring slash position — is exactly the bug that made
  // two different repositories derive to one directory last time.
  const firstColon = trimmed.indexOf(":");
  const firstSlash = trimmed.indexOf("/");
  const looksLikeScp = firstColon !== -1 && (firstSlash === -1 || firstColon < firstSlash);
  if (!looksLikeScp) {
    fail("Hub URL is a local path — a local hub is addressed local://<name> (ADR-0044), never by path", trimmed);
  }
  const authority = trimmed.slice(0, firstColon);
  const pathPart = trimmed.slice(firstColon + 1);
  // scp-like has NO port field (git help clone: `[user@]host.xz:path/to/repo.git/`)
  // — everything after the colon is the path. Passing scheme "scp" through
  // finishCanonicalize skips port parsing entirely (see below).
  return finishCanonicalize("scp", authority, pathPart, trimmed);
}

function finishCanonicalize(
  scheme: string,
  authority: string,
  pathPart: string,
  original: string,
): CanonicalHubRepo {
  // userinfo: drop everything up to and including the LAST '@' in the
  // authority. A credential is not an identity and must never reach a path.
  const atIdx = authority.lastIndexOf("@");
  const hostPort = atIdx === -1 ? authority : authority.slice(atIdx + 1);

  let rawHost: string;
  let port: number | null = null;

  if (scheme === "scp") {
    // No port field in scp-like syntax, ever — a leading numeric path segment
    // (`git@host:2222/o/r.git`) is a PATH component, not a port. Reading it as
    // one collides `git@host:2222/o/r.git` with `ssh://git@host:2222/o/r.git`.
    rawHost = hostPort;
  } else {
    if (hostPort.includes("[") || hostPort.includes("]")) {
      fail("IPv6 host literals are not supported", original);
    }
    const lastColon = hostPort.lastIndexOf(":");
    if (lastColon !== -1 && /^\d+$/.test(hostPort.slice(lastColon + 1))) {
      rawHost = hostPort.slice(0, lastColon);
      port = Number(hostPort.slice(lastColon + 1));
    } else {
      rawHost = hostPort;
    }
  }

  if (!rawHost) fail("Hub URL has no host", original);
  // The host becomes a directory segment. ".." escapes the hubs root; "."
  // silently collapses so https://./o/r and https://o/r would derive to the
  // same directory — checked BEFORE any port suffix is joined, so a port can
  // never launder it (see the char-safety check below for why appending one
  // wouldn't help anyway).
  if (rawHost === "." || rawHost === "..") {
    fail(`Hub URL host '${rawHost}' is unsafe as a directory segment`, original);
  }
  if (/[/\\:[\]\0]/.test(rawHost)) {
    fail("Hub URL host contains an unsafe character (/ \\ : [ ] or NUL)", original);
  }
  // A host must actually look like a hostname. Rejecting anything else is not
  // cosmetic: `hub_repo` is git-tracked, and the scp-like branch will happily
  // read `--upload-pack=x:y` as host `--upload-pack=x` + path `y`. That value is
  // then handed to `git clone`, where a leading `-` is an OPTION, and
  // `--upload-pack` names the command git runs for the remote side — an
  // arbitrary-execution primitive reachable from a committed metadata.json.
  // The `--` separator at the clone call site is the other half of this fix;
  // both are kept, because either alone leaves the other path unguarded.
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(rawHost)) {
    fail(
      `Hub URL host '${rawHost}' is not a valid hostname (letters, digits, '.' and '-', not leading or trailing '-')`,
      original,
    );
  }

  let host = rawHost.toLowerCase();
  if (port !== null) {
    const defaultPort = DEFAULT_PORTS[scheme];
    if (port !== defaultPort) {
      // '_' is illegal in a real hostname, so this join can never collide with
      // a literal host and stays reversible.
      host = `${host}_${port}`;
    }
  }

  let path = pathPart.replace(/^\/+/, "");
  // ~username expansion (ssh/git protocols + the explicit-leading-slash
  // scp-like form): the segment would be a home-reference inside a derived
  // directory, colliding conceptually with the home-relative grant form
  // (ADR-0043 §8). Reject rather than silently treat `~user` as an ordinary
  // segment.
  if (path.startsWith("~")) {
    fail("Hub URL uses ~username expansion, which is not supported as a hub address", original);
  }
  path = path.replace(/\/+$/, "");
  // Strip exactly ONE trailing .git (case-insensitive) — AFTER trailing-slash
  // stripping, so `repo.git/` and `repo.git` both lose exactly one `.git`.
  // `foo.git.git` keeps one: only the last occurrence is stripped.
  path = path.replace(/\.git$/i, "");

  if (!path) fail("Hub URL has no path", original);

  const rawSegments = path.split("/");
  const segments: string[] = [];
  for (const seg of rawSegments) {
    const lower = seg.toLowerCase();
    if (!lower || lower === "." || lower === ".." || /[\\:\0]/.test(lower)) {
      fail(`Hub URL path segment '${seg}' is unsafe (empty, '.', '..', or contains \\ : NUL)`, original);
    }
    // Never percent-decode: %2e%2e must stay a literal directory name.
    segments.push(lower);
  }

  return { host, segments, key: `${host}/${segments.join("/")}` };
}

// ─── derivation ─────────────────────────────────────────────────────────────

/** `$MAGE_HOME/hubs` when set, else `~/.mage/hubs`. Read lazily on every call
 *  (never cached at module scope) so tests can vary `MAGE_HOME` per case. */
export function hubsRoot(): string {
  const base = process.env.MAGE_HOME;
  return base ? join(base, "hubs") : join(homedir(), ".mage", "hubs");
}

/**
 * The deterministic local path for a hub remote: `<root>/<host>/<segments…>`.
 * Throws a {@link HubUrlError} if the URL doesn't canonicalize, or (defense in
 * depth — canonicalization already forbids `.`/`..` segments) if the joined
 * result would somehow escape `root`.
 */
export function deriveHubPath(url: string, root: string = hubsRoot()): string {
  const { host, segments } = canonicalizeHubRepo(url);
  const derived = join(root, host, ...segments);
  if (!isUnder(root, derived)) {
    fail("Derived hub path escapes the hubs root", url);
  }
  return derived;
}

/** {@link deriveHubPath}, but null instead of throwing. */
export function deriveHubPathSafe(url: string, root: string = hubsRoot()): string | null {
  try {
    return deriveHubPath(url, root);
  } catch {
    return null;
  }
}

// ─── which local root does a (hub_repo, hub_path) pair resolve to? ─────────
//
// The ONE function every call site uses to answer "which hub root does this
// pair resolve to" (ADR-0043 §5/§6 of this spec). Pure and synchronous — it
// does no filesystem access, so it can never diverge on an existsSync-vs-not
// gate the way two independently written lookups did last time. hub_repo (the
// authoritative address) wins when it canonicalizes; hub_path is the
// deprecated fallback. Whether the resulting root is actually PRESENT and
// hub-shaped is a separate question — see {@link verifyHubArrival}.

export type ChosenHubRootSource = "derived" | "hub_path";

export interface ChosenHubRoot {
  root: string;
  source: ChosenHubRootSource;
}

export function chosenHubRoot(
  hubRepo: string | null | undefined,
  hubPath: string | null | undefined,
  root: string = hubsRoot(),
): ChosenHubRoot | null {
  if (hubRepo) {
    const derived = deriveHubPathSafe(hubRepo, root);
    if (derived) return { root: derived, source: "derived" };
  }
  if (hubPath) return { root: hubPath, source: "hub_path" };
  return null;
}

// ─── arrival verification (ADR-0043 §2/§7; this spec §3) ───────────────────
//
// Two checks, both required before a DERIVED hub is used for real work: shape
// (looksLikeHub) and origin match (the clone found there really is the remote
// requested). Reading `.git/config` directly (never shelling out) — this runs
// on the capture hot path and must not depend on `git` being on PATH.

/**
 * The `origin` remote URL recorded in a git repo/worktree at `repoDir`, read
 * by parsing `.git` directly — never by shelling out (the capture hot path
 * must not depend on `git` being on PATH). Handles the worktree `gitdir:`
 * indirection: a `.git` FILE pointing at
 * `<main>/.git/worktrees/<name>`, whose `commondir` file (when present) points
 * back at the shared `.git` that actually holds `[remote "origin"]`. Returns
 * null on anything unreadable/unparseable — never throws.
 */
export async function readGitConfigOriginUrl(repoDir: string): Promise<string | null> {
  try {
    const gitPath = join(repoDir, ".git");
    const st = await stat(gitPath).catch(() => null);
    let configPath: string;
    if (st?.isDirectory()) {
      configPath = join(gitPath, "config");
    } else if (st?.isFile()) {
      const content = await readFile(gitPath, "utf8");
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(content);
      if (!m?.[1]) return null;
      const gitDirRaw = m[1];
      const gitDir = isAbsolute(gitDirRaw) ? gitDirRaw : resolve(repoDir, gitDirRaw);
      let commonGitDir = gitDir;
      try {
        const commonRaw = (await readFile(join(gitDir, "commondir"), "utf8")).trim();
        commonGitDir = isAbsolute(commonRaw) ? commonRaw : resolve(gitDir, commonRaw);
      } catch {
        // No commondir file — treat gitDir itself as the common dir.
      }
      configPath = join(commonGitDir, "config");
    } else {
      return null;
    }
    return parseOriginUrlFromConfig(await readFile(configPath, "utf8"));
  } catch {
    return null;
  }
}

/** PURE: the `url` under `[remote "origin"]` in a git config file's text, or null. */
export function parseOriginUrlFromConfig(configText: string): string | null {
  let inOrigin = false;
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section?.[1]) {
      inOrigin = /^remote\s+"origin"$/i.test(section[1].trim());
      continue;
    }
    if (inOrigin) {
      const kv = /^url\s*=\s*(.+)$/.exec(line);
      if (kv?.[1]) return kv[1].trim();
    }
  }
  return null;
}

export type HubArrivalReason = "absent" | "not-a-hub" | "origin-unreadable" | "origin-mismatch";

export interface HubArrivalResult {
  ok: boolean;
  reason?: HubArrivalReason;
  /** Redacted diagnostic detail, present for every non-ok result except plain absence. */
  detail?: string;
}

/**
 * The two checks ADR-0043 §2/§7 require before a hub found at `derivedPath` is
 * trusted as `hubRepo`'s clone: shape (looksLikeHub), then origin match. A
 * mismatch is reported (never thrown — this is called from the capture hot
 * path via {@link chosenHubRoot}'s consumers, which must never throw) with
 * BOTH remotes named, redacted. Never reuses, never clobbers.
 */
export async function verifyHubArrival(derivedPath: string, hubRepo: string): Promise<HubArrivalResult> {
  if (!(await exists(derivedPath))) return { ok: false, reason: "absent" };
  if (!(await looksLikeHub(derivedPath))) {
    return {
      ok: false,
      reason: "not-a-hub",
      detail: `${derivedPath} exists but is not a mage hub (no projects/ + metadata.json)`,
    };
  }
  const origin = await readGitConfigOriginUrl(derivedPath);
  if (!origin) {
    return {
      ok: false,
      reason: "origin-unreadable",
      detail: `could not read the origin remote at ${derivedPath}`,
    };
  }
  let actualKey: string;
  let expectedKey: string;
  try {
    actualKey = canonicalizeHubRepo(origin).key;
    expectedKey = canonicalizeHubRepo(hubRepo).key;
  } catch (err) {
    return { ok: false, reason: "origin-unreadable", detail: (err as Error).message };
  }
  if (actualKey !== expectedKey) {
    return {
      ok: false,
      reason: "origin-mismatch",
      detail:
        `hub_repo ${redactUrl(hubRepo)} does not match the clone's origin ` +
        `${redactUrl(origin)} found at ${derivedPath} — never reused, never clobbered`,
    };
  }
  return { ok: true };
}
