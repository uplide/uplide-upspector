/**
 * Credential masking for captured exchanges. Runs before an entry reaches the
 * store or crosses the RSC boundary, so nothing redacted here ever leaves the
 * process that captured it.
 *
 * Names are matched by their parts, not as a whole: `x-api-key`, `apiKey` and
 * `API_KEY` all split into `api` + `key`. A fixed list of exact names misses
 * every spelling it does not list; parts catch the conventions.
 *
 * Parts come in two strengths, because a word like `key` or `session` names a
 * secret only some of the time (`apiKey` vs `cacheKey`, `session` vs
 * `sessionCount`):
 * - a *strong* name is masked whatever its value;
 * - an *ambiguous* name is masked only when its value looks like a secret.
 * A trailing metadata part (`tokenType`, `passwordUpdatedAt`) describes a
 * secret instead of holding it, and booleans or nulls never hold one. Values
 * with a credential format are masked under any name, metadata or not.
 */

export const REDACTED = "«redacted»";

/** Extra names to mask: a string matches a whole name (case-insensitive). */
export type UpspectorRedactKey = string | RegExp;

export interface UpspectorRedactRules {
  /** Always masked, whatever the value. */
  keys?: readonly UpspectorRedactKey[];
  /** Never masked by name; credential-shaped values are still masked. */
  reveal?: readonly UpspectorRedactKey[];
}

const STRONG_PARTS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "authtoken",
  "bearer",
  "cookie",
  "credential",
  "credentials",
  "csrf",
  "jwt",
  "otp",
  "passphrase",
  "passwd",
  "password",
  "privatekey",
  "pwd",
  "secret",
  "sessionid",
  "sid",
  "signature",
  "token",
  "xsrf",
]);

const AMBIGUOUS_PARTS = new Set(["auth", "key", "session", "sig"]);

/** `<qualifier> key` is a credential: `apiKey`, `x-access-key`, `SECRET_KEY`. */
const KEY_QUALIFIERS = new Set([
  "access",
  "api",
  "auth",
  "client",
  "encryption",
  "license",
  "master",
  "private",
  "secret",
  "signing",
  "subscription",
]);

/** A last part that makes the name describe a secret rather than hold it. */
const METADATA_PARTS = new Set([
  "alg",
  "algorithm",
  "at",
  "changed",
  "count",
  "created",
  "disabled",
  "enabled",
  "endpoint",
  "exists",
  "expiration",
  "expires",
  "expiry",
  "field",
  "format",
  "hint",
  "kind",
  "label",
  "len",
  "length",
  "method",
  "mode",
  "name",
  "on",
  "path",
  "policy",
  "provider",
  "required",
  "scheme",
  "set",
  "size",
  "status",
  "strategy",
  "ttl",
  "type",
  "updated",
  "uri",
  "url",
  "version",
]);

/**
 * Values that are credentials whatever they are called. Deliberately narrow:
 * each pattern is a format, not a guess, so ordinary values are never masked.
 */
const SENSITIVE_VALUES = [
  /^(?:Bearer|Basic|Digest)\s+\S+/i,
  /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/,
  /^(?:sk|rk|pk)_(?:live|test)_\w{8,}/,
  /^gh[pousr]_\w{20,}/,
  /^xox[abposr]-[\w-]+/,
  /^AKIA[0-9A-Z]{16}$/,
];

type KeyStrength = "strong" | "ambiguous" | null;

function nameParts(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function matchesAny(name: string, keys: readonly UpspectorRedactKey[]): boolean {
  const lower = name.toLowerCase();

  return keys.some((key) =>
    typeof key === "string" ? key.toLowerCase() === lower : key.test(name),
  );
}

function keyStrength(name: string): KeyStrength {
  const parts = nameParts(name);
  let strength: KeyStrength = null;

  for (const [index, part] of parts.entries()) {
    const previous = parts[index - 1];
    const next = parts[index + 1];

    if (
      STRONG_PARTS.has(part) ||
      (part === "key" && previous !== undefined && KEY_QUALIFIERS.has(previous)) ||
      (part === "session" && next === "id")
    ) {
      strength = "strong";
      break;
    }
    if (AMBIGUOUS_PARTS.has(part)) strength = "ambiguous";
  }

  const last = parts[parts.length - 1];
  if (strength && parts.length > 1 && last && METADATA_PARTS.has(last)) {
    return null;
  }

  return strength;
}

/**
 * Whether a value has the shape of a generated secret: long, unbroken, and
 * built from at least one segment that mixes letters with digits. Readable
 * identifiers (`products:page:12`, `feature_flag_v3`, `user.profile.name`)
 * split into words, numbers and short tags, so they never qualify.
 */
function looksSecret(value: string): boolean {
  if (value.length < 16 || !/^[\w\-+/=.~:]+$/.test(value)) return false;

  return value
    .split(/[_\-.:/]+/)
    .some(
      (segment) =>
        segment.length > 4 && /[a-z]/i.test(segment) && /\d/.test(segment),
    );
}

/** Masked by its name alone, whatever the value. */
export function isSensitiveKey(
  name: string,
  extra: readonly UpspectorRedactKey[] = [],
): boolean {
  return matchesAny(name, extra) || keyStrength(name) === "strong";
}

export function isSensitiveValue(value: string): boolean {
  const trimmed = value.trim();

  return SENSITIVE_VALUES.some((pattern) => pattern.test(trimmed));
}

/**
 * The single decision for one named value. `ambiguousParent` is set inside an
 * object held by an ambiguous name (`session: { id }`), where a secret-looking
 * leaf is masked even though its own name says nothing.
 */
export function shouldRedact(
  name: string,
  value: unknown,
  rules: UpspectorRedactRules = {},
  ambiguousParent = false,
): boolean {
  if (matchesAny(name, rules.keys ?? [])) return true;
  if (typeof value === "string" && isSensitiveValue(value)) return true;
  if (matchesAny(name, rules.reveal ?? [])) return false;
  if (typeof value !== "string" && typeof value !== "number") return false;

  const strength = keyStrength(name);
  if (strength === "strong") return true;

  return (
    (strength === "ambiguous" || ambiguousParent) &&
    typeof value === "string" &&
    looksSecret(value)
  );
}

export function redactValue(
  name: string,
  value: string,
  rules: UpspectorRedactRules = {},
): string {
  return shouldRedact(name, value, rules) ? REDACTED : value;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/**
 * Masks userinfo and sensitive query values in place, leaving the rest of the
 * URL byte for byte as it was. The result is for display only.
 */
export function redactUrl(url: string, rules: UpspectorRedactRules = {}): string {
  const withoutUserinfo = url.replace(
    /^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i,
    `$1${REDACTED}@`,
  );
  const queryStart = withoutUserinfo.indexOf("?");
  if (queryStart === -1) return withoutUserinfo;

  const hashStart = withoutUserinfo.indexOf("#", queryStart);
  const end = hashStart === -1 ? withoutUserinfo.length : hashStart;
  const query = withoutUserinfo
    .slice(queryStart + 1, end)
    .split("&")
    .map((pair) => {
      const separator = pair.indexOf("=");
      if (separator === -1) return pair;

      const name = decode(pair.slice(0, separator));
      const value = decode(pair.slice(separator + 1));

      return shouldRedact(name, value, rules)
        ? `${pair.slice(0, separator)}=${REDACTED}`
        : pair;
    })
    .join("&");

  return `${withoutUserinfo.slice(0, queryStart + 1)}${query}${withoutUserinfo.slice(end)}`;
}

function redactTree(
  value: unknown,
  rules: UpspectorRedactRules,
  ambiguousParent: boolean,
): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    // Array items and root strings have no name; only their format counts,
    // or their shape when an ambiguous name holds the array.
    return isSensitiveValue(value) || (ambiguousParent && looksSecret(value))
      ? { value: REDACTED, changed: true }
      : { value, changed: false };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const result = redactTree(item, rules, ambiguousParent);
      changed ||= result.changed;
      return result.value;
    });

    return { value: items, changed };
  }

  if (value === null || typeof value !== "object") {
    return { value, changed: false };
  }

  let changed = false;
  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (item !== null && typeof item === "object") {
      // A container under a strong name is a secret as a whole
      // (`credentials: {...}`); under any other name it is walked.
      if (
        matchesAny(key, rules.keys ?? []) ||
        (!matchesAny(key, rules.reveal ?? []) && keyStrength(key) === "strong")
      ) {
        result[key] = REDACTED;
        changed = true;
        continue;
      }

      const nested = redactTree(
        item,
        rules,
        ambiguousParent || keyStrength(key) === "ambiguous",
      );
      changed ||= nested.changed;
      result[key] = nested.value;
      continue;
    }

    if (shouldRedact(key, item, rules, ambiguousParent)) {
      result[key] = REDACTED;
      changed = true;
      continue;
    }

    result[key] = item;
  }

  return { value: result, changed };
}

/**
 * Masks sensitive fields of a JSON body. Text that is not JSON, or JSON with
 * nothing to mask, comes back unchanged — re-serializing only when needed
 * keeps the panel's raw view faithful to what was sent.
 */
export function redactJsonText(
  text: string,
  rules: UpspectorRedactRules = {},
): string {
  const first = text.trimStart()[0];
  if (first !== "{" && first !== "[") return text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }

  const result = redactTree(parsed, rules, false);

  return result.changed ? JSON.stringify(result.value) : text;
}
