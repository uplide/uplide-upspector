import { takeUpspectorPayload } from "@uplide/upspector-protocol";
import type {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { beginCapture } from "./capture.js";
import { getUpspectorConfig } from "./config.js";
import { createEntry } from "./entry.js";
import { pushUpspectorEntry } from "./store.js";
import type { UpspectorEntry, UpspectorSource } from "./types.js";

export interface AttachUpspectorOptions {
  source?: UpspectorSource;
  /** Where entries go. Default: the browser overlay store. */
  onEntry?: (entry: UpspectorEntry) => void;
  /** Return false to leave a request untouched (e.g. outside a render). */
  inScope?: () => boolean;
}

function buildUrl(config: InternalAxiosRequestConfig | undefined): string {
  const url = config?.url ?? "";
  const baseURL = config?.baseURL;
  if (!baseURL) return url;

  try {
    return new URL(url, baseURL).toString();
  } catch {
    return url;
  }
}

/**
 * Times nothing itself — the backend already measured the request — it only
 * lifts the payload key off every response (success *and* error, because the
 * backend attaches it to the error envelope too) and hands it to `onEntry`.
 *
 * Returns a detach function so a running app can turn capturing back off.
 */
export function attachUpspector(
  api: AxiosInstance,
  options: AttachUpspectorOptions = {},
): () => void {
  const source = options.source ?? "csr";
  const onEntry = options.onEntry ?? pushUpspectorEntry;
  const finishers = new WeakMap<InternalAxiosRequestConfig, () => void>();

  const finish = (config: InternalAxiosRequestConfig | undefined) => {
    if (!config) return;

    finishers.get(config)?.();
    finishers.delete(config);
  };

  const capture = (response: AxiosResponse | undefined) => {
    const config = getUpspectorConfig();
    if (!config.enabled || !response) return;

    const taken = takeUpspectorPayload(response.data, config.responseKey);
    if (!taken) return;

    onEntry(
      createEntry(
        source,
        {
          method: response.config?.method ?? "get",
          url: buildUrl(response.config),
          statusCode: response.status,
          requestHeaders: response.config?.headers,
          params: response.config?.params,
          requestBody: response.config?.data,
          responseHeaders: response.headers,
          responseBody: response.data,
        },
        taken,
        config,
      ),
    );
  };

  const requestId = api.interceptors.request.use((request) => {
    if (getUpspectorConfig().enabled && (options.inScope?.() ?? true)) {
      finishers.set(request, beginCapture());
    }

    return request;
  });

  const responseId = api.interceptors.response.use(
    (response) => {
      if (finishers.has(response.config)) capture(response);
      finish(response.config);

      return response;
    },
    (error: AxiosError) => {
      if (error.config && finishers.has(error.config)) capture(error.response);
      finish(error.config);

      return Promise.reject(error);
    },
  );

  return () => {
    api.interceptors.request.eject(requestId);
    api.interceptors.response.eject(responseId);
  };
}
