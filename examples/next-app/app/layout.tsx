import { UpspectorRoot, openUpspectorScope } from "@uplide/upspector-next/server";
import type { ReactNode } from "react";
import { Suspense } from "react";

export const metadata = { title: "upspector example" };

export default function RootLayout({ children }: { children: ReactNode }) {
  // Before anything is awaited, so the page's own requests are inside the scope.
  openUpspectorScope({ profile: process.env.UPSPECTOR_RENDER_PROFILE === "true" });

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem", maxWidth: 760 }}>
        {children}
        <Suspense>
          <UpspectorRoot />
        </Suspense>
      </body>
    </html>
  );
}
