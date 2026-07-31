import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { isUnder, looksLikeHub } from "./path-guards.js";

// ─── types & errors ──────────────────────────────────────────────────────────

export interface CanonicalHubRepo {
  /** Host lowercased, default port dropped, "host_port" if non-default. */
  host: string;
  /** Lowercased path components, no trailing .git, no empty/./.. */
  segments: string[];
  /** "host/seg/seg" — stable identity for comparison. */
  key: string;
}

export class HubUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubUrlError";
  }
}

const DEFAULT_PORTS = new Set(["22", "443", "80", "9418"]);

// ─── URL canonicalization ────────────────────────────────────────────────────

/**
 * Parse and canonicalize a git remote URL per ADR-0043 §2 rules.
 * Accepts scp-like `git@host:path`, `ssh://`, `https://`, `http://`, `git://`.
 * Throws a typed {@link HubUrlError} on malformed or hostile URLs.
 */
export function canonicalizeHubRepo(url: string): CanonicalHubRepo {
  if (!url || typeof url !== "string" || !url.trim()) {
    throw new HubUrlError("Hub repository URL cannot be empty");
  }

  const raw = url.trim();

  // Check for path traversal or empty segments in raw URL string
  const afterScheme = raw.includes("://")
    ? raw.slice(raw.indexOf("://") + 3)
    : raw;
  const afterUser = afterScheme.includes("@")
    ? afterScheme.slice(afterScheme.indexOf("@") + 1)
    : afterScheme;
  const rawPathPart = afterUser.includes(":")
    ? afterUser.slice(afterUser.indexOf(":") + 1)
    : afterUser.includes("/")
      ? afterUser.slice(afterUser.indexOf("/"))
      : "";

  const rawPathSegs = rawPathPart.split("/");
  for (let i = 0; i < rawPathSegs.length; i++) {
    const s = rawPathSegs[i];
    // Leading or trailing slash in raw string produces empty string at first/last element
    if (i === 0 && s === "") continue;
    if (i === rawPathSegs.length - 1 && s === "") continue;
    if (s === "" || s === "." || s === "..") {
      throw new HubUrlError(
        `Invalid path segment '${s}' in URL '${url}': path traversal or empty segment rejected`,
      );
    }
  }

  let rawHost = "";
  let rawPort = "";
  let rawPath = "";

  if (raw.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new HubUrlError(`Invalid URL format: '${url}'`);
    }

    const scheme = parsed.protocol.slice(0, -1).toLowerCase();
    if (!["ssh", "https", "http", "git"].includes(scheme)) {
      throw new HubUrlError(`Unsupported URL scheme '${scheme}:' in '${url}'`);
    }

    rawHost = parsed.hostname;
    rawPort = parsed.port;
    rawPath = parsed.pathname;
  } else {
    // scp-like: [user@]host:path or [user@]host:port/path
    let scp = raw;
    if (scp.includes("@")) {
      scp = scp.slice(scp.indexOf("@") + 1);
    }

    const colonIdx = scp.indexOf(":");
    if (colonIdx === -1) {
      throw new HubUrlError(
        `Invalid git remote URL '${url}': missing host:path separator`,
      );
    }

    rawHost = scp.slice(0, colonIdx);
    const pathPart = scp.slice(colonIdx + 1);

    if (!rawHost) {
      throw new HubUrlError(`Invalid git remote URL '${url}': empty host`);
    }

    // NO port parsing here. git's scp-like form is `[user@]host:path` and has no
    // port syntax — everything after the colon is the path, and a port requires
    // the `ssh://host:port/path` form. Reading a leading numeric segment as a
    // port would make `git@host:2222/o/r.git` (path "2222/o/r") collide with
    // `ssh://git@host:2222/o/r.git` (port 2222, path "o/r") at one derived
    // directory — two different repositories, one home. That is exactly the
    // injectivity violation ADR-0043 §2 rejects the flat-slug design to prevent.
    rawPath = pathPart;
  }

  if (!rawHost) {
    throw new HubUrlError(`Invalid URL '${url}': host is missing`);
  }

  // Format host: lowercase, drop default ports
  let host = rawHost.toLowerCase();
  if (rawPort && !DEFAULT_PORTS.has(rawPort)) {
    host = `${host}_${rawPort}`;
  }

  // Process path
  let p = rawPath.replace(/^\/+|\/+$/g, "");

  // Strip ONE trailing .git if present
  if (p.endsWith(".git")) {
    p = p.slice(0, -4);
  }

  // Split by /
  const rawSegments = p.split("/");

  const segments: string[] = [];
  for (const seg of rawSegments) {
    const s = seg.toLowerCase();
    if (!s || s === "." || s === "..") {
      throw new HubUrlError(
        `Invalid path segment '${seg}' in URL '${url}': path traversal or empty segment rejected`,
      );
    }
    if (/[\\:\0]/.test(s)) {
      throw new HubUrlError(
        `Invalid characters in path segment '${seg}' in URL '${url}'`,
      );
    }
    segments.push(s);
  }

  if (segments.length === 0) {
    throw new HubUrlError(`Invalid URL '${url}': no valid path segments found`);
  }

  const key = `${host}/${segments.join("/")}`;

  return { host, segments, key };
}

// ─── derivation & path helpers ───────────────────────────────────────────────

/**
 * Root directory for derived hub clones ($MAGE_HOME/hubs or ~/.mage/hubs).
 */
export function hubsRoot(): string {
  return process.env.MAGE_HOME
    ? join(process.env.MAGE_HOME, "hubs")
    : join(homedir(), ".mage", "hubs");
}

/**
 * Derive the machine-wide local directory path for a hub repository URL.
 * Asserts the result stays under `hubsRoot()`. Throws {@link HubUrlError}.
 */
export function deriveHubPath(url: string, root?: string): string {
  const canonical = canonicalizeHubRepo(url);
  const hRoot = root ?? hubsRoot();
  const derived = join(hRoot, canonical.host, ...canonical.segments);

  // Assert containment — `hub_repo` is git-tracked and therefore untrusted
  // input, exactly as `hub_path` was (ADR-0043 §2).
  if (!isUnder(hRoot, derived)) {
    throw new HubUrlError(
      `Derived path '${derived}' escapes hubs root '${hRoot}'`,
    );
  }

  return derived;
}

/**
 * Safe version of {@link deriveHubPath} that returns null instead of throwing on invalid URL.
 */
export function deriveHubPathSafe(
  url: string | null | undefined,
  root?: string,
): string | null {
  if (!url) return null;
  try {
    return deriveHubPath(url, root);
  } catch {
    return null;
  }
}

/** Convert absolute path under homedir() to home-relative (~/...). */
export function toHomeRelative(absPath: string): string {
  const home = homedir();
  if (absPath === home) return "~";
  if (absPath.startsWith(home + sep) || absPath.startsWith(`${home}/`)) {
    return `~${absPath.slice(home.length)}`;
  }
  return absPath;
}

/** Convert a home-relative (~/...) or relative path to an absolute path. */
export function toAbsolutePath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(homedir(), p.slice(2));
  }
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

// ─── git config parsing & origin verification ────────────────────────────────

/** Parse `[remote "origin"]` section `url = ...` from `.git/config` content. */
export function parseOriginUrlFromGitConfig(configText: string): string | null {
  const lines = configText.split(/\r?\n/);
  let inOriginSection = false;
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      const header = line.slice(1, -1).trim();
      if (
        /^remote\s+"origin"$/i.test(header) ||
        /^remote\s+'origin'$/i.test(header)
      ) {
        inOriginSection = true;
      } else {
        inOriginSection = false;
      }
      continue;
    }
    if (inOriginSection) {
      const eqIndex = line.indexOf("=");
      if (eqIndex !== -1) {
        const key = line.slice(0, eqIndex).trim().toLowerCase();
        if (key === "url") {
          let val = line.slice(eqIndex + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          return val || null;
        }
      }
    }
  }
  return null;
}

/** Read `origin` remote URL from a git clone directory by reading `.git/config`. */
export async function readGitOriginUrl(dir: string): Promise<string | null> {
  const dotGitPath = join(dir, ".git");
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(dotGitPath);
  } catch {
    return null;
  }

  let gitDir = dotGitPath;
  if (st.isFile()) {
    try {
      const content = await readFile(dotGitPath, "utf8");
      const match = content.match(/^gitdir:\s*(.+)$/m);
      const target = match?.[1]?.trim() ?? "";
      if (!target) return null;
      gitDir = isAbsolute(target) ? target : resolve(dir, target);
    } catch {
      return null;
    }
  }

  // Check config in gitDir
  const configPath = join(gitDir, "config");
  try {
    const configText = await readFile(configPath, "utf8");
    const origin = parseOriginUrlFromGitConfig(configText);
    if (origin) return origin;
  } catch {
    // ignore
  }

  // Check commondir if gitDir was a worktree
  const commonDirPath = join(gitDir, "commondir");
  try {
    const commonRel = (await readFile(commonDirPath, "utf8")).trim();
    const realCommonDir = isAbsolute(commonRel)
      ? commonRel
      : resolve(gitDir, commonRel);
    const commonConfigText = await readFile(
      join(realCommonDir, "config"),
      "utf8",
    );
    return parseOriginUrlFromGitConfig(commonConfigText);
  } catch {
    return null;
  }
}

/** Verify that the clone at `hubPath` has an `origin` remote matching `expectedHubRepoUrl`. */
export async function verifyHubOrigin(
  hubPath: string,
  expectedHubRepoUrl: string,
): Promise<{
  ok: boolean;
  actualKey?: string;
  expectedKey?: string;
  actualUrl?: string;
  error?: string;
}> {
  let expectedCanonical: CanonicalHubRepo;
  try {
    expectedCanonical = canonicalizeHubRepo(expectedHubRepoUrl);
  } catch (err) {
    return {
      ok: false,
      error: `Invalid expected hub repository URL '${expectedHubRepoUrl}': ${(err as Error).message}`,
    };
  }

  const actualUrl = await readGitOriginUrl(hubPath);
  if (!actualUrl) {
    return {
      ok: false,
      expectedKey: expectedCanonical.key,
      error: `Hub at ${hubPath} has no readable 'origin' remote URL in .git/config (expected '${expectedCanonical.key}')`,
    };
  }

  let actualCanonical: CanonicalHubRepo;
  try {
    actualCanonical = canonicalizeHubRepo(actualUrl);
  } catch (err) {
    return {
      ok: false,
      actualUrl,
      expectedKey: expectedCanonical.key,
      error: `Hub at ${hubPath} has unparseable origin remote URL '${actualUrl}': ${(err as Error).message}`,
    };
  }

  if (actualCanonical.key === expectedCanonical.key) {
    return {
      ok: true,
      actualKey: actualCanonical.key,
      expectedKey: expectedCanonical.key,
      actualUrl,
    };
  }

  return {
    ok: false,
    actualKey: actualCanonical.key,
    expectedKey: expectedCanonical.key,
    actualUrl,
    error: `Hub origin mismatch at ${hubPath}: expected '${expectedCanonical.key}' (${expectedHubRepoUrl}), found '${actualCanonical.key}' (${actualUrl})`,
  };
}

// ─── displaced hub scan ──────────────────────────────────────────────────────

export interface DisplacedCandidate {
  path: string;
  originUrl: string | null;
  key?: string;
}

export interface DisplacedHubScanResult {
  misplaced?: {
    path: string;
    originUrl: string;
    key: string;
    mvCommand: string;
  };
  candidates: DisplacedCandidate[];
}

/** Scan `hubsRoot()` for displaced hub clones per ADR-0043 §4. */
export async function scanForDisplacedHub(
  requestedHubRepoUrl: string,
  hubsRootPath?: string,
): Promise<DisplacedHubScanResult> {
  const root = hubsRootPath ?? hubsRoot();
  const derived = deriveHubPathSafe(requestedHubRepoUrl, root);
  let expectedKey: string | null = null;
  try {
    expectedKey = canonicalizeHubRepo(requestedHubRepoUrl).key;
  } catch {
    // ignore
  }

  const candidates: DisplacedCandidate[] = [];
  let misplaced: DisplacedHubScanResult["misplaced"];

  async function walk(dir: string, depth: number) {
    if (depth > 4) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const fullPath = join(dir, entry);
      if (await looksLikeHub(fullPath)) {
        const originUrl = await readGitOriginUrl(fullPath);
        let key: string | undefined;
        if (originUrl) {
          try {
            key = canonicalizeHubRepo(originUrl).key;
          } catch {
            // ignore
          }
        }

        const candidate: DisplacedCandidate = {
          path: fullPath,
          originUrl,
          key,
        };
        candidates.push(candidate);

        if (
          expectedKey &&
          key === expectedKey &&
          fullPath !== derived &&
          originUrl &&
          key
        ) {
          misplaced = {
            path: fullPath,
            originUrl,
            key,
            mvCommand: derived
              ? `mv "${fullPath}" "${derived}"`
              : `mv "${fullPath}" <derived-path>`,
          };
        }
      } else {
        await walk(fullPath, depth + 1);
      }
    }
  }

  let rootExists = false;
  try {
    const s = await stat(root);
    rootExists = s.isDirectory();
  } catch {
    rootExists = false;
  }

  if (rootExists) {
    await walk(root, 1);
  }

  return { misplaced, candidates };
}

// ─── high-level resolution engine ───────────────────────────────────────────

export type ResolveHubPathStatus =
  | "derived"
  | "fallback"
  | "origin_mismatch"
  | "misplaced"
  | "absent";

export interface ResolveHubPathResult {
  status: ResolveHubPathStatus;
  hubRoot: string | null;
  derivedPath?: string;
  fallbackPath?: string;
  deprecationNotice?: string;
  error?: string;
  displacedScan?: DisplacedHubScanResult;
}

/**
 * Resolve a hub root path following ADR-0043 §5 resolution order.
 */
export async function resolveHubPath(opts: {
  hub_repo?: string | null;
  hub_path?: string | null;
  hubsRootPath?: string;
}): Promise<ResolveHubPathResult> {
  const { hub_repo, hub_path, hubsRootPath } = opts;

  if (hub_repo) {
    let derivedPath: string;
    try {
      derivedPath = deriveHubPath(hub_repo, hubsRootPath);
    } catch (err) {
      if (hub_path && (await looksLikeHub(hub_path))) {
        return {
          status: "fallback",
          hubRoot: hub_path,
          fallbackPath: hub_path,
          deprecationNotice: `Deprecation notice: hub_repo '${hub_repo}' is invalid (${(err as Error).message}). Falling back to hub_path at ${hub_path}.`,
        };
      }
      return {
        status: "absent",
        hubRoot: null,
        error: (err as Error).message,
      };
    }

    let derivedExists = false;
    try {
      derivedExists = await looksLikeHub(derivedPath);
    } catch {
      derivedExists = false;
    }

    if (derivedExists) {
      const originRes = await verifyHubOrigin(derivedPath, hub_repo);
      if (originRes.ok) {
        return {
          status: "derived",
          hubRoot: derivedPath,
          derivedPath,
        };
      }
      return {
        status: "origin_mismatch",
        hubRoot: null,
        derivedPath,
        error: originRes.error,
      };
    }

    // Derived path absent or failing shape gate -> try fallback hub_path
    if (hub_path && (await looksLikeHub(hub_path))) {
      return {
        status: "fallback",
        hubRoot: hub_path,
        derivedPath,
        fallbackPath: hub_path,
        deprecationNotice: `Deprecation notice: hub_path '${hub_path}' is deprecated (ADR-0043). Relocate hub to derived path ${derivedPath} and update configuration.`,
      };
    }

    // Neither derived path nor fallback hub_path resolved -> scan displaced hubs
    const scanRes = await scanForDisplacedHub(hub_repo, hubsRootPath);
    if (scanRes.misplaced) {
      return {
        status: "misplaced",
        hubRoot: null,
        derivedPath,
        displacedScan: scanRes,
      };
    }

    return {
      status: "absent",
      hubRoot: null,
      derivedPath,
      displacedScan: scanRes,
    };
  }

  // No hub_repo, but hub_path present (e.g. remote-less standalone hub)
  if (hub_path && (await looksLikeHub(hub_path))) {
    return {
      status: "fallback",
      hubRoot: hub_path,
      fallbackPath: hub_path,
    };
  }

  return {
    status: "absent",
    hubRoot: null,
  };
}
