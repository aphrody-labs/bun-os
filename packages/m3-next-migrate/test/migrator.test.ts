// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  transformComponent,
  scanNextDirectory,
  migrateProject,
  getImageProps,
  Inter,
  localFont,
  cookies,
  headers,
  NavigationRedirectError,
  NavigationNotFoundError,
  buildRouteHierarchy,
  composeLayouts,
  generateAppRouterCode,
  setWindowTitle,
  setMetaTag,
  syncMetadata,
  resolveTitle,
  NextRequest,
  NextResponse,
} from "../src/index";
import React from "react";

function RootLayout({ children }: { children: React.ReactNode }) {
  return React.createElement("div", { "data-testid": "root" }, children);
}
function SubLayout({ children }: { children: React.ReactNode }) {
  return React.createElement("div", { "data-testid": "sub" }, children);
}
function Page() {
  return React.createElement("span", null, "Page Content");
}

describe("@aphrody/m3-next-migrate", () => {
  describe("transformComponent", () => {
    it("strips 'use client' and rewrites next/navigation and next/link", () => {
      const source = `'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function Nav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <nav>
      <Link href="/dashboard">Dashboard</Link>
    </nav>
  );
}
`;

      const result = transformComponent(source, { target: "tauri" });
      expect(result.modified).toBe(true);
      expect(result.code).not.toContain("'use client'");
      expect(result.code).toContain("from '@aphrody/m3-next-migrate/shims/navigation'");
      expect(result.code).toContain("from '@aphrody/m3-next-migrate/shims/link'");
      expect(result.transformations.length).toBeGreaterThanOrEqual(3);
    });

    it("transforms next/image and next/dynamic", () => {
      const source = `import Image from 'next/image';
import dynamic from 'next/dynamic';

const DynamicWidget = dynamic(() => import('./Widget'), { ssr: false });

export function Hero() {
  return (
    <div>
      <Image src="/hero.png" width={800} height={400} alt="Hero" priority fill />
      <DynamicWidget />
    </div>
  );
}
`;

      const result = transformComponent(source, { target: "tauri" });
      expect(result.code).toContain("from '@aphrody/m3-next-migrate/shims/image'");
      expect(result.code).toContain("from '@aphrody/m3-next-migrate/shims/dynamic'");
    });

    it("transforms next/font/google and next/font/local", () => {
      const source = `import { Inter, Roboto_Mono } from 'next/font/google';
import localFont from 'next/font/local';

const inter = Inter({ subsets: ['latin'] });
const customFont = localFont({ src: './custom.woff2' });
`;

      const result = transformComponent(source, { target: "vite" });
      expect(result.code).toContain("from '@aphrody/m3-next-migrate/shims/font'");
    });

    it("rewrites process.env.NEXT_PUBLIC_* to import.meta.env", () => {
      const source = `export const apiUrl = process.env.NEXT_PUBLIC_API_URL;
export const isProd = process.env.NODE_ENV === 'production';
`;

      const result = transformComponent(source);
      expect(result.code).toContain("import.meta.env.VITE_API_URL");
      expect(result.code).toContain("import.meta.env.MODE");
    });

    it("adapts Next 16 async page props", () => {
      const source = `export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>, searchParams: Promise<{ q: string }> }) {
  const p = await params;
  const s = await searchParams;
  return <div>Item {p.id} query {s.q}</div>;
}
`;

      const result = transformComponent(source);
      expect(result.code).toContain("export default function Page({ params, searchParams }");
      expect(result.code).not.toContain("await params");
      expect(result.code).not.toContain("await searchParams");
    });

    it("handles Server Action directives and gives warnings for Tauri", () => {
      const source = `'use server';
export async function saveProfile(formData: FormData) {
  // DB logic
}
`;

      const result = transformComponent(source, { target: "tauri" });
      expect(result.code).not.toContain("'use server'");
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("modernizes UI components to authentic @aphrody/m3-primitives (--m3)", () => {
      const source = `import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

export default function Panel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings <Badge variant="secondary">Active</Badge></CardTitle>
      </CardHeader>
      <CardContent>
        <Input placeholder="Enter username" />
        <Tooltip>
          <TooltipTrigger><Button variant="destructive">Delete</Button></TooltipTrigger>
          <TooltipContent>Irreversible</TooltipContent>
        </Tooltip>
        <Button variant="ghost">Cancel</Button>
        <Button variant="outline">Reset</Button>
        <Collapsible>
          <CollapsibleTrigger>Advanced</CollapsibleTrigger>
          <CollapsibleContent>Details</CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
`;

      const result = transformComponent(source, { modernizeM3: true });
      expect(result.modified).toBe(true);
      expect(result.code).toContain("from '@aphrody/m3-primitives'");
      expect(result.code).not.toContain("@/components/ui/button");
      expect(result.code).not.toContain("@/components/ui/input");
      expect(result.code).not.toContain("@/components/ui/card");
      expect(result.code).not.toContain("@/components/ui/badge");
      expect(result.code).not.toContain("@/components/ui/tooltip");
      expect(result.code).not.toContain("@/components/ui/collapsible");

      // Check variant conversions
      expect(result.code).toContain("variant='accent'"); // from destructive
      expect(result.code).toContain("variant='text'"); // from ghost
      expect(result.code).toContain("variant='outlined'"); // from outline

      // Check Tooltip compound adaptation
      expect(result.code).toContain("<TooltipRoot");
      expect(result.code).toContain("</TooltipRoot>");
    });

    it("adapts Root Layout <html> and <body> tags for desktop/SPA container", () => {
      const source = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
`;

      const result = transformComponent(source, { adaptRootLayout: true });
      expect(result.modified).toBe(true);
      expect(result.code).not.toContain("<html");
      expect(result.code).not.toContain("</html>");
      expect(result.code).not.toContain("<body");
      expect(result.code).not.toContain("</body>");
      expect(result.code).not.toContain("suppressHydrationWarning");
      expect(result.code).toContain('<div data-root-layout className="m3-app-root" lang="en">');
      expect(result.code).toContain(
        '<div className={["m3-app-body", "font-sans antialiased"].filter(Boolean).join(" ")} >',
      );
    });

    it("supports static metadata and synchronizes with Tauri window title", () => {
      const source = `import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Aphrody Desktop',
  description: 'M3 Desktop App',
};

export default function Home() {
  return <main>Home</main>;
}
`;

      const result = transformComponent(source, { syncMetadataTitle: true });
      expect(result.modified).toBe(true);
      expect(result.code).toContain("from '@aphrody/m3-next-migrate/shims/metadata'");
      expect(result.code).toContain("useMetadata(metadata)");
    });

    it("supports dynamic generateMetadata", () => {
      const source = `export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const p = await params;
  return { title: \`Item \${p.id}\` };
}

export default function ItemDetail({ params }: { params: any }) {
  return <div>Item Detail</div>;
}
`;

      const result = transformComponent(source, { syncMetadataTitle: true });
      expect(result.modified).toBe(true);
      expect(result.code).toContain("useMetadata");
      expect(result.code).toContain("generateMetadata");
    });

    it("performs n2b transforms: next/server, node: prefix, shebang, and import.meta", () => {
      const source = `#!/usr/bin/env node
import { NextResponse, type NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const dir = __dirname;
  return NextResponse.json({ dir });
}
`;

      const result = transformComponent(source, { n2b: true });
      expect(result.modified).toBe(true);
      expect(result.code).toContain("#!/usr/bin/env bun");
      expect(result.code).toContain("from '@aphrody/m3-next-migrate/shims/server'");
      expect(result.code).toContain("from 'node:fs'");
      expect(result.code).toContain("from 'node:path'");
      expect(result.code).toContain("import.meta.dirname");
      expect(result.code).not.toContain("__dirname");
    });
  });

  describe("Layout Hierarchy & Router", () => {
    it("builds route hierarchy with nested layouts", () => {
      const files = [
        "app/layout.tsx",
        "app/page.tsx",
        "app/dashboard/layout.tsx",
        "app/dashboard/page.tsx",
        "app/dashboard/settings/page.tsx",
        "app/items/[id]/page.tsx",
      ];

      const hierarchy = buildRouteHierarchy(files);
      expect(hierarchy.layouts.length).toBe(2);
      expect(hierarchy.routes.length).toBe(4);

      // Home route
      const homeRoute = hierarchy.routes.find(r => r.routePath === "/");
      expect(homeRoute).toBeDefined();
      expect(homeRoute?.layouts).toEqual(["app/layout.tsx"]);

      // Dashboard route
      const dashRoute = hierarchy.routes.find(r => r.routePath === "/dashboard");
      expect(dashRoute).toBeDefined();
      expect(dashRoute?.layouts).toEqual(["app/layout.tsx", "app/dashboard/layout.tsx"]);

      // Dashboard settings route
      const dashSettingsRoute = hierarchy.routes.find(r => r.routePath === "/dashboard/settings");
      expect(dashSettingsRoute).toBeDefined();
      expect(dashSettingsRoute?.layouts).toEqual(["app/layout.tsx", "app/dashboard/layout.tsx"]);

      // Dynamic item route
      const itemRoute = hierarchy.routes.find(r => r.routePath === "/items/:id");
      expect(itemRoute).toBeDefined();
      expect(itemRoute?.params).toEqual(["id"]);
      expect(itemRoute?.layouts).toEqual(["app/layout.tsx"]);
    });

    it("composes layout stack around page component correctly", () => {
      const composed = composeLayouts([RootLayout, SubLayout], Page);
      expect(composed.type).toBe(RootLayout);
      expect((composed.props as any).children.type).toBe(SubLayout);
      expect((composed.props as any).children.props.children.type).toBe(Page);
    });

    it("generates App router code containing nested layout imports and route dispatch", () => {
      const files = ["app/layout.tsx", "app/page.tsx", "app/dashboard/layout.tsx", "app/dashboard/page.tsx"];
      const hierarchy = buildRouteHierarchy(files);
      const code = generateAppRouterCode(hierarchy, { modernizeM3: true });

      expect(code).toContain("import { usePathname } from '@aphrody/m3-next-migrate/shims/navigation'");
      expect(code).toContain("import { composeLayouts } from '@aphrody/m3-next-migrate/layout'");
      expect(code).toContain("import '@aphrody/m3-theme/m3.css'");
      expect(code).toContain("Layout_0");
      expect(code).toContain("Layout_1");
      expect(code).toContain("Page_0");
      expect(code).toContain("Page_1");
      expect(code).toContain("composeLayouts");
    });
  });

  describe("Metadata & Title Shims", () => {
    it("resolves title strings and templates", () => {
      expect(resolveTitle("Direct Title")).toBe("Direct Title");
      expect(resolveTitle({ default: "Default Title" })).toBe("Default Title");
      expect(resolveTitle({ default: "App", template: "%s | App" }, "Dashboard")).toBe("Dashboard | App");
      expect(resolveTitle({ absolute: "Exact Title" })).toBe("Exact Title");
    });

    it("syncs document title and creates meta tags", async () => {
      await setWindowTitle("Aphrody Tauri Window");
      if (typeof document !== "undefined") {
        expect(document.title).toBe("Aphrody Tauri Window");

        setMetaTag("description", "A modern desktop application");
        const meta = document.querySelector('meta[name="description"]');
        expect(meta?.getAttribute("content")).toBe("A modern desktop application");

        await syncMetadata({
          title: "New Title",
          description: "New Desc",
          applicationName: "Aphrody App",
        });
        expect(document.title).toBe("New Title");
      }
    });
  });

  describe("Server & Bun Native APIs", () => {
    it("NextResponse and NextRequest support standard Next.js 16 signatures", async () => {
      const res = NextResponse.json({ success: true }, { status: 200 });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const redirectRes = NextResponse.redirect("https://aphrody.com");
      expect(redirectRes.headers.get("Location")).toBe("https://aphrody.com");

      const req = new NextRequest("http://localhost:1420/api/users?page=2", {
        headers: { Cookie: "session=abc123xyz" },
      });
      expect(req.nextUrl.pathname).toBe("/api/users");
      expect(req.nextUrl.searchParams.get("page")).toBe("2");
      expect(req.cookies.get("session")).toBe("abc123xyz");
    });
  });

  describe("Runtime Shims", () => {
    it("getImageProps properly calculates fill and priority properties", () => {
      const { props } = getImageProps({
        src: "/test.png",
        alt: "Test",
        width: 400,
        height: 200,
        fill: true,
        priority: true,
      });

      expect(props.src).toBe("/test.png");
      expect(props.loading).toBe("eager");
      expect(props.fetchPriority).toBe("high");
      expect(props.style?.position).toBe("absolute");
      expect(props.style?.objectFit).toBe("cover");
    });

    it("font shims provide className and CSS variables", () => {
      const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
      expect(inter.variable).toBe("--font-inter");
      expect(inter.className).toBe("font-inter");

      const local = localFont({
        src: "./my-font.woff2",
        variable: "--font-brand",
      });
      expect(local.variable).toBe("--font-brand");
      expect(local.className).toBe("font-local");
    });

    it("cookies and headers shims return async compatibility objects", async () => {
      const cookieStore = await cookies();
      expect(typeof cookieStore.get).toBe("function");
      expect(typeof cookieStore.getAll).toBe("function");

      const headerList = await headers();
      expect(typeof headerList.get).toBe("function");
    });

    it("redirect and notFound error classes are constructable", () => {
      const redirectErr = new NavigationRedirectError("/login");
      expect(redirectErr.url).toBe("/login");
      expect(redirectErr.message).toContain("/login");

      const notFoundErr = new NavigationNotFoundError();
      expect(notFoundErr.message).toBe("NEXT_NOT_FOUND");
    });
  });

  describe("Scanner and Full Project Migration", () => {
    it("scans and migrates a complete Next.js 16 app with nested layouts, M3 primitives, and metadata to the native Bun web host", async () => {
      // A private temporary tree: independent of the working directory and of concurrent runs.
      const tempRoot = await mkdtemp(join(tmpdir(), "m3-next-migrate-"));
      const tempTestDir = join(tempRoot, "next_app");
      const tempDestDir = join(tempRoot, "output");
      try {
        // Setup mock Next.js 16 app with nested layouts, metadata, and shadcn UI components
        await mkdir(join(tempTestDir, "app/dashboard"), { recursive: true });
        await mkdir(join(tempTestDir, "components/ui"), { recursive: true });

        // 1. Root Layout with metadata
        await writeFile(
          join(tempTestDir, "app/layout.tsx"),
          `import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Next 16 App',
  description: 'Migration to Tauri',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
`,
        );

        // 2. Root Page
        await writeFile(
          join(tempTestDir, "app/page.tsx"),
          `'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function Home() {
  const router = useRouter();
  return (
    <main>
      <h1>Next 16 Welcome</h1>
      <Link href="/dashboard">Go to Dashboard</Link>
      <Image src="/logo.png" width={200} height={50} alt="Logo" />
      <Input placeholder="Search..." />
      <Button variant="destructive">Primary Action</Button>
    </main>
  );
}
`,
        );

        // 3. Nested Dashboard Layout
        await writeFile(
          join(tempTestDir, "app/dashboard/layout.tsx"),
          `import { Badge } from '@/components/ui/badge';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-container">
      <header>
        <h2>Dashboard</h2>
        <Badge variant="secondary">Pro</Badge>
      </header>
      {children}
    </section>
  );
}
`,
        );

        // 4. Nested Dashboard Page with Card and Collapsible
        await writeFile(
          join(tempTestDir, "app/dashboard/page.tsx"),
          `import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

export async function generateMetadata() {
  return { title: 'Dashboard Metrics' };
}

export default function DashboardPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <Collapsible>
          <CollapsibleTrigger>More</CollapsibleTrigger>
          <CollapsibleContent>Details</CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
`,
        );

        // Scan
        const scanStats = await scanNextDirectory(tempTestDir);
        expect(scanStats.totalFiles).toBe(4);
        expect(scanStats.layouts.length).toBe(2);
        expect(scanStats.pages.length).toBe(2);
        expect(scanStats.metadataCount).toBe(1);
        expect(scanStats.generateMetadataCount).toBe(1);
        expect(scanStats.m3CandidateCount).toBe(3);

        // Migrate with --m3
        const report = await migrateProject({
          sourceDir: tempTestDir,
          targetDir: tempDestDir,
          target: "vite",
          projectName: "test-native-m3-app",
          scaffold: false,
          modernizeM3: true,
        });

        expect(report.migratedFiles).toBe(4);
        expect(report.hierarchy.routes.length).toBe(2);
        expect(report.hierarchy.layouts.length).toBe(2);

        expect(await Bun.file(join(tempDestDir, "package.json")).exists()).toBe(false);
        expect(await Bun.file(join(tempDestDir, "src-tauri/tauri.conf.json")).exists()).toBe(false);

        // Check migrated Root Layout: html/body rewritten
        const migratedRootLayout = await Bun.file(join(tempDestDir, "app/layout.tsx")).text();
        expect(migratedRootLayout).not.toContain("<html");
        expect(migratedRootLayout).not.toContain("<body");
        expect(migratedRootLayout).toContain("data-root-layout");
        expect(migratedRootLayout).toContain("m3-app-body");
        expect(migratedRootLayout).toContain("useMetadata(metadata)");

        // Check migrated Home Page: M3 Button/Input imported, destructive -> accent
        const migratedPageContent = await Bun.file(join(tempDestDir, "app/page.tsx")).text();
        expect(migratedPageContent).toContain("from '@aphrody/m3-primitives'");
        expect(migratedPageContent).toContain("variant='accent'");

        // Check migrated Dashboard Layout: M3 Badge imported
        const migratedDashLayout = await Bun.file(join(tempDestDir, "app/dashboard/layout.tsx")).text();
        expect(migratedDashLayout).toContain("from '@aphrody/m3-primitives'");

        // Check migrated Dashboard Page: M3 Card & Collapsible imported
        const migratedDashPage = await Bun.file(join(tempDestDir, "app/dashboard/page.tsx")).text();
        expect(migratedDashPage).toContain("from '@aphrody/m3-primitives'");
        expect(migratedDashPage).toContain("useMetadata");
      } finally {
        await rm(tempDestDir, { recursive: true, force: true });
        await rm(tempRoot, { recursive: true, force: true });
      }
    });
  });
});
