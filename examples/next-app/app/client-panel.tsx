"use client";

import { attachUpspector } from "@uplide/upspector/axios";
import axios from "axios";
import { useState } from "react";
import { API_BASE_URL } from "@/lib/api";

const api = axios.create({ baseURL: API_BASE_URL });
attachUpspector(api);

/** Browser-side requests: `fetch` is captured by the client instrumentation, axios by its interceptor. */
export function ClientPanel() {
  const [result, setResult] = useState("");

  async function run(label: string, request: () => Promise<unknown>) {
    try {
      setResult(`${label}: ${JSON.stringify(await request()).slice(0, 160)}`);
    } catch (error) {
      setResult(`${label}: ${String(error)}`);
    }
  }

  return (
    <section style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 24 }}>
      <button
        onClick={() =>
          run("fetch", async () => (await fetch(`${API_BASE_URL}/api/products/1`)).json())
        }
        type="button"
      >
        fetch product 1
      </button>
      <button
        onClick={() => run("axios", async () => (await api.get("/api/products")).data)}
        type="button"
      >
        axios product list
      </button>
      <button
        onClick={() => run("axios 400", () => api.post("/api/products", {}))}
        type="button"
      >
        axios invalid create (400)
      </button>
      <button
        onClick={() =>
          run("opt-out", async () =>
            (await fetch(`${API_BASE_URL}/api/products/2`, { upspector: false })).json(),
          )
        }
        type="button"
      >
        fetch with upspector: false
      </button>
      <p style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}>{result}</p>
    </section>
  );
}
