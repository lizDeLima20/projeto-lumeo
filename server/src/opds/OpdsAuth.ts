import bcrypt from "bcryptjs";
import type { IncomingMessage } from "node:http";
import type { OpdsStore, OpdsUser } from "./OpdsUserRepository.js";

/** bcrypt cost for new passwords (about a quarter of a second each on a server). */
export const OPDS_BCRYPT_COST = 12;
/** Failed sign-ins tolerated in the window before the catalog stops answering them. */
export const OPDS_LOGIN_MAX_FAILURES = 5;
/** The same address trying many usernames is stopped too. */
export const OPDS_LOGIN_MAX_FAILURES_PER_IP = 20;
export const OPDS_LOGIN_WINDOW_MS = 15 * 60_000;

/** A hash nobody's password matches: a missing user costs the same time as a wrong password. */
const NO_USER_HASH = "$2b$12$p7MzmUboNJ99E0p5e.JRye6QBKhe422VJ.3kOE9iUqyO.UcsJNrBq";

export function hashOpdsPassword(password: string): Promise<string> { return bcrypt.hash(password, OPDS_BCRYPT_COST); }

export type OpdsAuthResult =
  | { kind: "ok"; user: OpdsUser }
  | { kind: "missing" | "invalid" }
  | { kind: "locked"; retryAfterSeconds: number };

/**
 * HTTP Basic Auth for the catalog (KOReader sends the catalog's username and password this
 * way). Failures are counted in the database, never in memory: Vercel instances share nothing.
 */
export class OpdsAuth {
  public constructor(private readonly store: OpdsStore, private readonly now: () => Date = () => new Date()) {}

  public async authenticate(request: IncomingMessage, ip: string): Promise<OpdsAuthResult> {
    const credentials = OpdsAuth.credentials(request.headers.authorization);
    if (!credentials) return { kind: "missing" };
    const username = credentials.username.trim().toLocaleLowerCase("en-US");
    const since = new Date(this.now().getTime() - OPDS_LOGIN_WINDOW_MS);
    const failures = await this.store.failures(username, ip, since);
    if (failures.forUser >= OPDS_LOGIN_MAX_FAILURES || failures.forIp >= OPDS_LOGIN_MAX_FAILURES_PER_IP) return { kind: "locked", retryAfterSeconds: OPDS_LOGIN_WINDOW_MS / 1000 };
    const user = username ? await this.store.findUser(username) : null;
    const matches = await bcrypt.compare(credentials.password, user?.passwordHash ?? NO_USER_HASH);
    if (user && user.active && matches) return { kind: "ok", user };
    await this.store.recordFailure(username, ip);
    return { kind: "invalid" };
  }

  /** "Basic base64(user:password)"; the password may itself contain ":". */
  public static credentials(header: string | undefined): { username: string; password: string } | null {
    const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? "");
    if (!match) return null;
    const decoded = Buffer.from(match[1]!, "base64").toString("utf8"), colon = decoded.indexOf(":");
    if (colon < 0) return null;
    const username = decoded.slice(0, colon), password = decoded.slice(colon + 1);
    if (!username || username.length > 120 || password.length > 256) return null;
    return { username, password };
  }
}
