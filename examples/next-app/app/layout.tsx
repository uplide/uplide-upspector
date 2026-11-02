import { DebugbarRoot, openDebugbarScope } from "@uplide/debugbar-next/server";
import type { ReactNode } from "react";
import { Suspense } from "react";

export const metadata = { title: "debugbar example" };

export default function RootLayout({ children }: { children: ReactNode }) {
  // Before anything is awaited, so the page's own requests are inside the scope.
  openDebugbarScope({ profile: process.env.DEBUGBAR_RENDER_PROFILE === "true" });

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem", maxWidth: 760 }}>
        {children}
        <Suspense>
          <DebugbarRoot />
        </Suspense>
      </body>
    </html>
  );
}
