import { describe, expect, it } from "vitest";
import { configStep } from "../src/steps/config.js";
import { envStep } from "../src/steps/env.js";
import { routeStep } from "../src/steps/route.js";
import { instrumentationClientStep, instrumentationStep } from "../src/steps/instrumentation.js";
import { layoutStep } from "../src/steps/layout.js";
import { nextConfigStep } from "../src/steps/next-config.js";
import { LAYOUT, NEXT_CONFIG, runStep } from "./helpers.js";

describe("config", () => {
  it("creates upspector.config with the chosen env variable", () => {
    const { written } = runStep(configStep);

    expect(written["upspector.config.ts"]).toBe(`import { defineNextUpspectorConfig } from "@uplide/upspector-next";

export default defineNextUpspectorConfig({
  enabled: process.env.NEXT_PUBLIC_UPSPECTOR === "true",
  backend: { origins: [process.env.NEXT_PUBLIC_API_BASE_URL] },
});
`);
  });

  it("keeps an existing config in any extension withUpspector reads", () => {
    const { result, written } = runStep(configStep, { "upspector.config.mjs": "export default {};\n" });

    expect(result.status).toBe("skipped");
    expect(written).toEqual({});
  });
});

describe("next-config", () => {
  it("wraps the exported config", () => {
    const { written } = runStep(nextConfigStep, { "next.config.ts": NEXT_CONFIG });

    expect(written["next.config.ts"]).toBe(`import type { NextConfig } from "next";
import { withUpspector } from "@uplide/upspector-next/config";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withUpspector(nextConfig);
`);
  });

  it("wraps other plugins from the outside, in the file's quote style", () => {
    const { written } = runStep(nextConfigStep, {
      "next.config.mjs": `import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

export default withNextIntl({ reactStrictMode: true });
`,
    });

    expect(written["next.config.mjs"]).toBe(`import createNextIntlPlugin from 'next-intl/plugin';
import { withUpspector } from '@uplide/upspector-next/config';

const withNextIntl = createNextIntlPlugin();

export default withUpspector(withNextIntl({ reactStrictMode: true }));
`);
  });

  it("leaves a config function alone", () => {
    const { result, written } = runStep(nextConfigStep, {
      "next.config.ts": `const config = async (phase: string) => ({});\n\nexport default config;\n`,
    });

    expect(result.status).toBe("manual");
    expect(written).toEqual({});
  });

  it("leaves CommonJS alone", () => {
    const { result } = runStep(nextConfigStep, { "next.config.js": "module.exports = {};\n" });

    expect(result.status).toBe("manual");
  });

  it("is idempotent", () => {
    const { result } = runStep(nextConfigStep, {
      "next.config.ts": `import { withUpspector } from "@uplide/upspector-next/config";\n\nexport default withUpspector({});\n`,
    });

    expect(result.status).toBe("skipped");
  });
});

describe("instrumentation", () => {
  it("creates the hook", () => {
    const { written } = runStep(instrumentationStep);

    expect(written["instrumentation.ts"]).toBe(`export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerUpspector } = await import("@uplide/upspector-next/server");
    const { default: upspector } = await import("./upspector.config");

    registerUpspector(upspector);
  }
}
`);
  });

  it("registers first in an existing register(), making it async", () => {
    const { written } = runStep(instrumentationStep, {
      "instrumentation.ts": `import * as Sentry from "@sentry/nextjs";

export function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({});
  }
}

export const onRequestError = Sentry.captureRequestError;
`,
    });

    expect(written["instrumentation.ts"]).toBe(`import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerUpspector } = await import("@uplide/upspector-next/server");
    const { default: upspector } = await import("./upspector.config");

    registerUpspector(upspector);
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({});
  }
}

export const onRequestError = Sentry.captureRequestError;
`);
  });

  it("adds register() when the file has none", () => {
    const { written } = runStep(instrumentationStep, {
      "instrumentation.ts": "export const onRequestError = () => {};\n",
    });

    expect(written["instrumentation.ts"]).toBe(`export const onRequestError = () => {};

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerUpspector } = await import("@uplide/upspector-next/server");
    const { default: upspector } = await import("./upspector.config");

    registerUpspector(upspector);
  }
}
`);
  });

  it("goes in src/ and imports the root config from there", () => {
    const { written } = runStep(instrumentationStep, { "src/app/layout.tsx": "" });

    expect(written["src/instrumentation.ts"]).toContain('await import("../upspector.config")');
  });
});

describe("instrumentation-client", () => {
  it("creates the file", () => {
    const { written } = runStep(instrumentationClientStep);

    expect(written["instrumentation-client.ts"]).toBe(`import { installUpspectorClient } from "@uplide/upspector-next/client";
import upspector from "./upspector.config";

installUpspectorClient(upspector);
`);
  });

  it("installs before the file's own code", () => {
    const { written } = runStep(instrumentationClientStep, {
      "src/app/layout.tsx": "",
      "src/instrumentation-client.ts": `import posthog from "posthog-js";

posthog.init("key");

export function onRouterTransitionStart() {}
`,
    });

    expect(written["src/instrumentation-client.ts"]).toBe(`import posthog from "posthog-js";
import { installUpspectorClient } from "@uplide/upspector-next/client";
import upspector from "../upspector.config";

installUpspectorClient(upspector);

posthog.init("key");

export function onRouterTransitionStart() {}
`);
  });
});

describe("layout", () => {
  it("opens the scope and renders UpspectorRoot in the create-next-app layout", () => {
    const { written } = runStep(layoutStep);

    expect(written["app/layout.tsx"]).toBe(`import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { UpspectorRoot, openUpspectorScope } from "@uplide/upspector-next/server";
import { Suspense } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Create Next App",
  description: "Generated by create next app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Before anything is awaited, so the page's own requests are inside the scope.
  openUpspectorScope({ profile: process.env.UPSPECTOR_RENDER_PROFILE === "true" });

  return (
    <html lang="en">
      <body className={\`\${geistSans.variable} antialiased\`}>
        {children}
        <Suspense>
          <UpspectorRoot />
        </Suspense>
      </body>
    </html>
  );
}
`);
  });

  it("joins an existing react import and keeps an inline body inline", () => {
    const { written } = runStep(layoutStep, {
      "app/layout.tsx": `import type { ReactNode } from "react";
import { StrictMode } from "react";

const RootLayout = async ({ children }: { children: ReactNode }) => {
  const locale = await getLocale();
  return <html lang={locale}><body>{children}</body></html>;
};

export default RootLayout;
`,
    });

    expect(written["app/layout.tsx"]).toBe(`import type { ReactNode } from "react";
import { StrictMode, Suspense } from "react";
import { UpspectorRoot, openUpspectorScope } from "@uplide/upspector-next/server";

const RootLayout = async ({ children }: { children: ReactNode }) => {
  // Before anything is awaited, so the page's own requests are inside the scope.
  openUpspectorScope({ profile: process.env.UPSPECTOR_RENDER_PROFILE === "true" });

  const locale = await getLocale();
  return <html lang={locale}><body>{children}<Suspense><UpspectorRoot /></Suspense></body></html>;
};

export default RootLayout;
`);
  });

  it("adds its own react import next to a namespace import", () => {
    const { written } = runStep(layoutStep, {
      "app/layout.tsx": `import * as React from "react";\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html><body>{children}</body></html>;\n}\n`,
    });

    expect(written["app/layout.tsx"]).toContain(`import * as React from "react";`);
    expect(written["app/layout.tsx"]).toContain(`import { Suspense } from "react";`);
  });

  it("imports Suspense under its own name when the file aliases it", () => {
    const { written } = runStep(layoutStep, {
      "app/layout.tsx": `import { Suspense as ReactSuspense } from "react";\n\nexport default function RootLayout({ children }) {\n  return <html><body>{children}</body></html>;\n}\n`,
    });

    expect(written["app/layout.tsx"]).toMatch(/import \{ Suspense as ReactSuspense, Suspense \} from "react";/);
  });

  it("keeps a 4-space file with a doc comment at 4 spaces", () => {
    const { written } = runStep(layoutStep, {
      "app/layout.tsx": `/**\n * The root layout.\n */\nexport default function RootLayout({ children }) {\n    return (\n        <html>\n            <body>\n                {children}\n            </body>\n        </html>\n    );\n}\n`,
    });

    expect(written["app/layout.tsx"]).toContain(
      `                <Suspense>\n                    <UpspectorRoot />\n                </Suspense>\n            </body>`,
    );
    expect(written["app/layout.tsx"]).toContain(`\n    openUpspectorScope(`);
  });

  it("keeps CRLF line endings", () => {
    const { written } = runStep(layoutStep, {
      "app/layout.tsx": LAYOUT.replace(/\n/g, "\r\n"),
    });

    expect(written["app/layout.tsx"]).not.toMatch(/[^\r]\n/);
  });

  it("leaves a client layout alone", () => {
    const { result, written } = runStep(layoutStep, {
      "app/layout.tsx": `"use client";\n\nexport default function RootLayout({ children }) {\n  return <html><body>{children}</body></html>;\n}\n`,
    });

    expect(result.status).toBe("manual");
    expect(written).toEqual({});
  });

  it("leaves a layout whose <body> is rendered elsewhere alone", () => {
    const { result } = runStep(layoutStep, {
      "app/layout.tsx": `import { Shell } from "./shell";\n\nexport default function RootLayout({ children }) {\n  return <Shell>{children}</Shell>;\n}\n`,
    });

    expect(result.status).toBe("manual");
  });

  it("is idempotent", () => {
    const { written: first } = runStep(layoutStep);
    const { result } = runStep(layoutStep, first);

    expect(result.status).toBe("skipped");
  });
});

describe("route", () => {
  it("creates the route under the app directory", () => {
    const { written } = runStep(routeStep, { "src/app/layout.tsx": "" });

    expect(Object.keys(written)).toEqual(["src/app/api/upspector/[endpoint]/route.ts"]);
  });
});

describe("env", () => {
  it("adds the switch to .env.example", () => {
    const { written } = runStep(envStep, { ".env.example": "NEXT_PUBLIC_API_BASE_URL=" });

    expect(written[".env.example"]).toBe("NEXT_PUBLIC_API_BASE_URL=\nNEXT_PUBLIC_UPSPECTOR=false\n");
  });

  it("does nothing without .env.example", () => {
    const { result, written } = runStep(envStep);

    expect(result.status).toBe("skipped");
    expect(written).toEqual({});
  });
});
