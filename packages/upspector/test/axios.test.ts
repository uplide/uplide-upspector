import axios, { type AxiosAdapter } from "axios";
import { beforeEach, describe, expect, it } from "vitest";
import { attachUpspector } from "../src/axios.js";
import { setUpspectorConfig } from "../src/config.js";
import type { UpspectorEntry } from "../src/types.js";
import { payload } from "./fixtures.js";

let entries: UpspectorEntry[];
const onEntry = (entry: UpspectorEntry) => entries.push(entry);

function client(status: number, data: unknown) {
  const adapter: AxiosAdapter = async (config) => {
    const response = {
      data,
      status,
      statusText: "",
      headers: { "content-type": "application/json", "set-cookie": ["sid=1"] },
      config,
    };
    if (status >= 400) {
      throw new axios.AxiosError("failed", "ERR_BAD_RESPONSE", config, null, response);
    }
    return response;
  };

  return axios.create({ baseURL: "https://api.example.test", adapter });
}

beforeEach(() => {
  entries = [];
  setUpspectorConfig({ enabled: true, match: () => true, redactHeaders: ["x-tenant"] });
});

describe("attachUpspector", () => {
  it("captures a success response and removes the key", async () => {
    const api = client(200, { data: 1, upspector: payload });
    attachUpspector(api, { onEntry });

    const response = await api.get("/items", {
      params: { page: 2 },
      headers: { authorization: "Bearer s", "x-tenant": "t1" },
    });

    expect(response.data).toEqual({ data: 1 });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.url).toBe("https://api.example.test/items");
    expect(entries[0]?.exchange.query).toEqual({ page: "2" });
    expect(entries[0]?.exchange.requestHeaders.authorization).toBe("«redacted»");
    expect(entries[0]?.exchange.requestHeaders["x-tenant"]).toBe("«redacted»");
    expect(entries[0]?.exchange.responseHeaders["set-cookie"]).toBe("«redacted»");
  });

  it("captures the error envelope too", async () => {
    const api = client(422, { message: "invalid", upspector: payload });
    attachUpspector(api, { onEntry });

    await expect(api.post("/items", { a: 1 })).rejects.toMatchObject({
      response: { data: { message: "invalid" } },
    });
    expect(entries[0]?.statusCode).toBe(422);
    expect(entries[0]?.exchange.requestBody?.text).toBe('{"a":1}');
  });

  it("skips requests outside the scope and stops after detach", async () => {
    const api = client(200, { upspector: payload });
    const detach = attachUpspector(api, { onEntry, inScope: () => false });

    expect((await api.get("/a")).data).toEqual({ upspector: payload });
    detach();
    attachUpspector(api, { onEntry });
    await api.get("/a");

    expect(entries).toHaveLength(1);
  });
});
