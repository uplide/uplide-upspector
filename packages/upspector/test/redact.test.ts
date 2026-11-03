import { describe, expect, it } from "vitest";
import { defineUpspectorConfig } from "../src/config.js";
import { createEntry, toBody } from "../src/entry.js";
import {
  isSensitiveKey,
  isSensitiveValue,
  REDACTED,
  redactJsonText,
  redactUrl,
  shouldRedact,
} from "../src/redact.js";
import { payload } from "./fixtures.js";

const config = defineUpspectorConfig({ enabled: true, match: () => true });

describe("isSensitiveKey", () => {
  it("matches name parts in any spelling", () => {
    for (const name of [
      "Authorization",
      "X-Api-Token",
      "X-Access-Token",
      "apikey",
      "api_key",
      "apiKey",
      "X-Service-Secret",
      "passwordHash",
      "refresh_token",
      "set-cookie",
      "X-Amz-Security-Token",
    ]) {
      expect(isSensitiveKey(name), name).toBe(true);
    }
  });

  it("leaves ordinary names alone", () => {
    for (const name of ["page", "keyword", "content-type", "x-trace", "tokenizer"]) {
      expect(isSensitiveKey(name), name).toBe(false);
    }
  });

  it("honours extra names and patterns", () => {
    expect(isSensitiveKey("X-Tenant", ["x-tenant"])).toBe(true);
    expect(isSensitiveKey("customer_ssn", [/ssn$/])).toBe(true);
  });
});

describe("shouldRedact — false positives", () => {
  const SECRET = "9f86d081884c7d659a2feaa0c55ad015";

  it.each([
    // Ambiguous parts with ordinary values.
    ["primaryKey", "id"],
    ["cacheKey", "products:list:page:12"],
    ["sortKey", "createdAt"],
    ["key", "user.profile.name"],
    ["i18nKey", "en-US_homepage_title_2"],
    ["sessionCount", 3],
    ["session", "feature_flag_checkout_v3"],
    ["authMethod", "password"],
    ["authProvider", "google"],
    // Metadata about a secret, not the secret.
    ["tokenType", "bearer"],
    ["token_type", "Bearer"],
    ["tokenExpiresAt", "2026-11-02T10:00:00Z"],
    ["expiresIn", 3600],
    ["passwordUpdatedAt", "2026-11-02"],
    ["passwordPolicy", "strong"],
    ["passwordResetRequired", "true"],
    ["signatureVersion", "v4"],
    ["cookieName", "sid"],
    ["tokenCount", 1200],
    // Booleans and nulls never hold a secret.
    ["hasPassword", true],
    ["password", null],
    ["otpEnabled", false],
    ["isAuthenticated", true],
  ])("shows %s = %j", (name, value) => {
    expect(shouldRedact(name, value)).toBe(false);
  });

  it.each([
    ["password", "hunter2"],
    ["otp", 123456],
    ["accessToken", "short"],
    ["apiKey", "abc"],
    ["X-Secret-Key", "abc"],
    ["sessionId", "s1"],
    ["key", "AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY"],
    ["session", SECRET],
    ["x-internal-auth", SECRET],
    ["tokenType", "Bearer eyJabc"],
    ["description", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig"],
  ])("masks %s = %j", (name, value) => {
    expect(shouldRedact(name, value)).toBe(true);
  });

  it("masks generated values under an ambiguous container", () => {
    expect(
      JSON.parse(
        redactJsonText(
          JSON.stringify({ session: { id: SECRET, userId: 7, startedAt: "2026-11-02" } }),
        ),
      ),
    ).toEqual({ session: { id: REDACTED, userId: 7, startedAt: "2026-11-02" } });
  });

  it("masks a container under a strong name as a whole", () => {
    expect(redactJsonText('{"credentials":{"user":"a","pass":"b"}}')).toBe(
      `{"credentials":"${REDACTED}"}`,
    );
  });

  it("reveals names on request but never credential-shaped values", () => {
    const rules = { reveal: ["sessionId", /^password$/] };

    expect(shouldRedact("sessionId", "s1", rules)).toBe(false);
    expect(shouldRedact("password", "hunter2", rules)).toBe(false);
    expect(shouldRedact("sessionId", "Bearer abc", rules)).toBe(true);
  });
});

describe("isSensitiveValue", () => {
  it("recognises credential formats only", () => {
    expect(isSensitiveValue("Bearer abc.def")).toBe(true);
    expect(isSensitiveValue("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig")).toBe(true);
    expect(isSensitiveValue("sk_live_0123456789abcdef")).toBe(true);
    expect(isSensitiveValue("hello world")).toBe(false);
    expect(isSensitiveValue("2026-11-02")).toBe(false);
  });
});

describe("redactUrl", () => {
  it("masks sensitive query values and userinfo, keeping the rest verbatim", () => {
    expect(
      redactUrl("https://user:pw@api.test/v1/me?page=2&access_token=abc&q=a%20b#top"),
    ).toBe(`https://${REDACTED}@api.test/v1/me?page=2&access_token=${REDACTED}&q=a%20b#top`);
  });

  it("masks a credential-shaped value under any name", () => {
    expect(redactUrl("/cb?state=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig")).toBe(
      `/cb?state=${REDACTED}`,
    );
  });
});

describe("redactJsonText", () => {
  it("masks nested fields and leaves untouched text byte-identical", () => {
    expect(
      JSON.parse(
        redactJsonText(
          '{"email":"a@b.c","password":"pw","user":{"passwordHash":"h","tags":["Bearer x"]}}',
        ),
      ),
    ).toEqual({
      email: "a@b.c",
      password: REDACTED,
      user: { passwordHash: REDACTED, tags: [REDACTED] },
    });

    const clean = '{ "name": "x" }';
    expect(redactJsonText(clean)).toBe(clean);
    expect(redactJsonText("not json")).toBe("not json");
  });

  it("is applied by toBody before truncation", () => {
    expect(toBody({ token: "a".repeat(50) }, 20)?.text).toBe(`{"token":"«redacted»"}`.slice(0, 20));
  });
});

describe("createEntry", () => {
  const raw = {
    method: "GET",
    url: "https://api.internal/v1/me?access_token=SECRET_QS&page=1",
    statusCode: 200,
    requestHeaders: {
      Authorization: "Bearer SECRET_A",
      "X-Api-Token": "SECRET_B",
      "X-Service-Name": "SECRET_E",
      "content-type": "application/json",
    },
    requestBody: JSON.stringify({ email: "a@b.c", password: "SECRET_PW" }),
    responseHeaders: { "content-type": "application/json", "x-backend-node": "n1" },
    responseBody: JSON.stringify({ data: { id: 1, refreshToken: "SECRET_RT" } }),
  };

  it("never lets a secret into an SSR entry", () => {
    const entry = createEntry("ssr", raw, { payload }, config);

    expect(JSON.stringify(entry)).not.toMatch(/SECRET_/);
    expect(entry.url).toBe(`https://api.internal/v1/me?access_token=${REDACTED}&page=1`);
    expect(entry.exchange.query).toEqual({ access_token: REDACTED, page: "1" });
    // Allowlisted headers keep their value; any other name is masked.
    expect(entry.exchange.requestHeaders["content-type"]).toBe("application/json");
    expect(entry.exchange.requestHeaders["X-Service-Name"]).toBe(REDACTED);
    expect(entry.exchange.responseHeaders["x-backend-node"]).toBe(REDACTED);
  });

  it("shows ordinary headers in CSR entries and when the allowlist is off", () => {
    const csr = createEntry("csr", raw, { payload }, config);
    const all = createEntry(
      "ssr",
      raw,
      { payload },
      defineUpspectorConfig({ ...config, ssrHeaders: "all" }),
    );
    const extended = createEntry(
      "ssr",
      raw,
      { payload },
      defineUpspectorConfig({ ...config, ssrHeaders: ["x-backend-node"] }),
    );

    expect(csr.exchange.requestHeaders["X-Service-Name"]).toBe("SECRET_E");
    expect(csr.exchange.requestHeaders["X-Api-Token"]).toBe(REDACTED);
    expect(all.exchange.requestHeaders["X-Service-Name"]).toBe("SECRET_E");
    expect(all.exchange.requestHeaders.Authorization).toBe(REDACTED);
    expect(extended.exchange.responseHeaders["x-backend-node"]).toBe("n1");
  });

  it("applies redactKeys to headers, query and bodies", () => {
    const entry = createEntry(
      "csr",
      {
        ...raw,
        url: "https://api.internal/v1/me?tenant=t1",
        requestHeaders: { "X-Tenant": "t1" },
        requestBody: JSON.stringify({ tenant: "t1" }),
      },
      { payload },
      defineUpspectorConfig({ ...config, redactKeys: [/^x?-?tenant$/i] }),
    );

    expect(entry.url).toBe(`https://api.internal/v1/me?tenant=${REDACTED}`);
    expect(entry.exchange.requestHeaders["X-Tenant"]).toBe(REDACTED);
    expect(entry.exchange.requestBody?.text).toBe(`{"tenant":"${REDACTED}"}`);
  });
});
