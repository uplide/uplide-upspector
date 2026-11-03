import type { UpspectorCollector } from '../collector';
import { getUpspectorCollector } from '../context';

interface HttpCallState {
  startHr: number;
  collector: UpspectorCollector;
}

/** Symbol-keyed so an instrumented config/instance never gains a JSON key. */
const CALL_STATE = Symbol('upspector.http.callState');
const INSTRUMENTED = Symbol('upspector.http.instrumented');

interface AxiosConfigLike {
  method?: string;
  url?: string;
  baseURL?: string;
  [CALL_STATE]?: HttpCallState;
}

interface AxiosResponseLike {
  status?: number;
  config?: AxiosConfigLike;
}

interface AxiosErrorLike {
  message?: string;
  code?: string;
  response?: AxiosResponseLike;
  config?: AxiosConfigLike;
}

interface AxiosInstanceLike {
  interceptors: {
    request: {
      use(onFulfilled: (config: AxiosConfigLike) => AxiosConfigLike): unknown;
    };
    response: {
      use(
        onFulfilled: (response: AxiosResponseLike) => AxiosResponseLike,
        onRejected: (error: unknown) => unknown,
      ): unknown;
    };
  };
  [INSTRUMENTED]?: boolean;
}

interface AxiosModuleLike extends AxiosInstanceLike {
  create?: (...args: unknown[]) => AxiosInstanceLike;
}

/** Query strings can carry tokens and ids — record path only. */
function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

function resolveAxiosUrl(config: AxiosConfigLike | undefined): string {
  const url = config?.url ?? '';
  const base = config?.baseURL;
  if (!base || /^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return stripQuery(url);
  }

  return stripQuery(`${base.replace(/\/$/, '')}/${url.replace(/^\//, '')}`);
}

function recordAxiosCall(
  config: AxiosConfigLike | undefined,
  statusCode: number | undefined,
  error: string | undefined,
): void {
  const state = config?.[CALL_STATE];
  if (!state) {
    return;
  }

  config[CALL_STATE] = undefined;
  state.collector.recordHttp({
    method: (config.method ?? 'get').toUpperCase(),
    url: resolveAxiosUrl(config),
    statusCode,
    startHr: state.startHr,
    durationMs: performance.now() - state.startHr,
    error,
  });
}

function instrumentAxiosInstance<T extends AxiosInstanceLike>(instance: T): T {
  if (!instance?.interceptors || instance[INSTRUMENTED]) {
    return instance;
  }
  instance[INSTRUMENTED] = true;

  instance.interceptors.request.use((config) => {
    const collector = getUpspectorCollector();
    if (collector) {
      config[CALL_STATE] = { startHr: performance.now(), collector };
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => {
      recordAxiosCall(response?.config, response?.status, undefined);
      return response;
    },
    (error: unknown) => {
      const axiosError = error as AxiosErrorLike | undefined;
      const config = axiosError?.config ?? axiosError?.response?.config;
      recordAxiosCall(
        config,
        axiosError?.response?.status,
        axiosError?.message ?? axiosError?.code ?? 'request failed',
      );
      return Promise.reject(error);
    },
  );

  return instance;
}

/**
 * Times every outbound axios call.
 *
 * Instruments the default instance and patches `create`, so instances built
 * later (`@nestjs/axios` builds its `HttpService` instance via `axios.create`)
 * are covered too — without touching a single feature file.
 */
export function installAxiosInstrumentation(axiosModule: unknown): void {
  if (!axiosModule || typeof axiosModule !== 'object') {
    return;
  }

  // Boundary cast: axios is duck-typed so this package does not depend on it.
  const client = axiosModule as AxiosModuleLike;

  const originalCreate = client.create;
  if (typeof originalCreate === 'function' && !client[INSTRUMENTED]) {
    client.create = (...args: unknown[]) =>
      instrumentAxiosInstance(originalCreate.apply(client, args));
  }

  instrumentAxiosInstance(client);
}

interface FetchHolder {
  fetch: typeof fetch;
  [INSTRUMENTED]?: boolean;
}

/**
 * Times every outbound `fetch` call (Xero/Tripletex/realtime-bridge clients
 * use `fetch`, not axios). Idempotent per target.
 */
export function installFetchInstrumentation(target?: {
  fetch: typeof fetch;
}): void {
  const holder = (target ?? globalThis) as FetchHolder;
  if (typeof holder.fetch !== 'function' || holder[INSTRUMENTED]) {
    return;
  }
  holder[INSTRUMENTED] = true;

  const originalFetch = holder.fetch.bind(holder);

  holder.fetch = async (input, init) => {
    const collector = getUpspectorCollector();
    if (!collector) {
      return originalFetch(input, init);
    }

    const request = typeof input === 'object' && 'url' in input ? input : null;
    const url = stripQuery(request ? request.url : String(input));
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const startHr = performance.now();

    try {
      const response = await originalFetch(input, init);
      collector.recordHttp({
        method,
        url,
        statusCode: response.status,
        startHr,
        durationMs: performance.now() - startHr,
      });
      return response;
    } catch (error) {
      collector.recordHttp({
        method,
        url,
        startHr,
        durationMs: performance.now() - startHr,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}
