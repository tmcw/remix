import { test, expect } from "@playwright/test";

import {
  createAppFixture,
  createFixture,
  js,
} from "./helpers/create-fixture.js";
import type { Fixture, AppFixture } from "./helpers/create-fixture.js";
import { PlaywrightFixture } from "./helpers/playwright-fixture.js";
import { createProject, viteBuild } from "./helpers/vite.js";

// SSR'd useId value we can assert against pre- and post-hydration
const USE_ID_VALUE = ":R1:";

test.describe("SPA Mode", () => {
  let fixture: Fixture;
  let appFixture: AppFixture;

  test.beforeAll(async () => {
    fixture = await createFixture({
      compiler: "vite",
      files: {
        "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { unstable_vitePlugin as remix } from "@remix-run/dev";

          export default defineConfig({
            plugins: [remix({ unstable_ssr: false })],
          });
        `,
        "app/root.tsx": js`
          import * as React from "react";
          import { Form, Link, Links, Meta, Outlet, Scripts } from "@remix-run/react";

          export default function Root() {
            let id = React.useId();
            return (
              <html lang="en">
                <head>
                  <Meta />
                  <Links />
                </head>
                <body>
                    <h1 data-root>Root</h1>
                    <pre data-use-id>{id}</pre>
                    <nav>
                      <Link to="/about">/about</Link>
                      <br/>

                      <Form method="post" action="/about">
                        <button type="submit">
                          Submit /about
                        </button>
                      </Form>
                      <br/>

                      <Link to="/error">/error</Link>
                      <br/>

                      <Form method="post" action="/error">
                        <button type="submit">
                          Submit /error
                        </button>
                      </Form>
                      <br/>
                     </nav>
                    <Outlet />
                  <Scripts />
                </body>
              </html>
            );
          }

          export function HydrateFallback() {
            const id = React.useId();
            const [hydrated, setHydrated] = React.useState(false);
            React.useEffect(() => setHydrated(true), []);

            return (
              <html lang="en">
                <head>
                  <Meta />
                  <Links />
                </head>
                <body>
                  <h1 data-loading>Loading SPA...</h1>
                  <pre data-use-id>{id}</pre>
                  {hydrated ? <h3 data-hydrated>Hydrated</h3> : null}
                  <Scripts />
                </body>
              </html>
            );
          }
        `,
        "app/routes/_index.tsx": js`
          import * as React  from "react";
          import { useLoaderData } from "@remix-run/react";

          export function meta({ data }) {
            return [{
              title: "Index Title: " + data
            }];
          }

          export async function clientLoader({ request }) {
            if (new URL(request.url).searchParams.has('slow')) {
              await new Promise(r => setTimeout(r, 500));
            }
            return "Index Loader Data";
          }

          export default function Component() {
            let data = useLoaderData();
            const [mounted, setMounted] = React.useState(false);
            React.useEffect(() => setMounted(true), []);

            return (
              <>
                <h2 data-route>Index</h2>
                <p data-loader-data>{data}</p>
                {!mounted ? <h3>Unmounted</h3> : <h3 data-mounted>Mounted</h3>}
              </>
            );
          }
        `,
        "app/routes/about.tsx": js`
          import { useActionData, useLoaderData } from "@remix-run/react";

          export function meta({ data }) {
            return [{
              title: "About Title: " + data
            }];
          }

          export function clientLoader() {
            return "About Loader Data";
          }

          export function clientAction() {
            return "About Action Data";
          }

          export default function Component() {
            let data = useLoaderData();
            let actionData = useActionData();

            return (
              <>
                <h2 data-route>About</h2>
                <p data-loader-data>{data}</p>
                <p data-action-data>{actionData}</p>
              </>
            );
          }
        `,
        "app/routes/error.tsx": js`
          import { useRouteError } from "@remix-run/react";

          export async function clientLoader({ serverLoader }) {
            await serverLoader();
            return null;
          }

          export async function clientAction({ serverAction }) {
            await serverAction();
            return null;
          }

          export default function Component() {
            return <h2>Error</h2>;
          }

          export function ErrorBoundary() {
            let error = useRouteError();
            return <pre data-error>{error.data}</pre>
          }
        `,
      },
    });

    appFixture = await createAppFixture(fixture);
  });

  test.afterAll(() => {
    appFixture.close();
  });

  test.describe("builds", () => {
    test("errors on server-only exports", async () => {
      let cwd = await createProject({
        "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { unstable_vitePlugin as remix } from "@remix-run/dev";

          export default defineConfig({
            plugins: [remix({ unstable_ssr: false })],
          });
        `,
        "app/routes/invalid-exports.tsx": String.raw`
          // Invalid exports
          export function headers() {}
          export function loader() {}
          export function action() {}

          // Valid exports
          export function clientLoader() {}
          export function clientAction() {}
          export default function Component() {}
        `,
      });
      let result = viteBuild({ cwd });
      let stderr = result.stderr.toString("utf8");
      expect(stderr).toMatch(
        "SPA Mode: 3 invalid route export(s) in `routes/invalid-exports.tsx`: " +
          "`headers`, `loader`, `action`. See https://remix.run/future/spa-mode " +
          "for more information."
      );
    });

    test("errors on HydrateFallback export from non-root route", async () => {
      let cwd = await createProject({
        "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { unstable_vitePlugin as remix } from "@remix-run/dev";

          export default defineConfig({
            plugins: [remix({ unstable_ssr: false })],
          });
        `,
        "app/routes/invalid-exports.tsx": String.raw`
          // Invalid exports
          export function HydrateFallback() {}

          // Valid exports
          export function clientLoader() {}
          export function clientAction() {}
          export default function Component() {}
        `,
      });
      let result = viteBuild({ cwd });
      let stderr = result.stderr.toString("utf8");
      expect(stderr).toMatch(
        "SPA Mode: Invalid `HydrateFallback` export found in `routes/invalid-exports.tsx`. " +
          "`HydrateFallback` is only permitted on the root route in SPA Mode. " +
          "See https://remix.run/future/spa-mode for more information."
      );
    });
  });

  test.describe("javascript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("renders the root HydrateFallback", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("[data-loading]").textContent()).toBe(
        "Loading SPA..."
      );
      expect(await page.locator("[data-use-id]").textContent()).toBe(
        USE_ID_VALUE
      );
      expect(await page.locator("title").textContent()).toBe(
        "Index Title: undefined"
      );
    });
  });

  test.describe("javascript enabled", () => {
    test("hydrates", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");
      expect(await page.locator("[data-loader-data]").textContent()).toBe(
        "Index Loader Data"
      );
      expect(await page.locator("[data-mounted]").textContent()).toBe(
        "Mounted"
      );
      expect(await page.locator("title").textContent()).toBe(
        "Index Title: Index Loader Data"
      );
    });

    test("hydrates a proper useId value", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/?slow");

      // We should hydrate the same useId value in HydrateFallback that we
      // rendered on the server above
      await page.waitForSelector("[data-hydrated]");
      expect(await page.locator("[data-use-id]").textContent()).toBe(
        USE_ID_VALUE
      );

      // Once hydrated, we should get a different useId value from the root component
      await page.waitForSelector("[data-route]");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");
      expect(await page.locator("[data-use-id]").textContent()).not.toBe(
        USE_ID_VALUE
      );
    });

    test("navigates and calls loaders", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");

      await app.clickLink("/about");
      await page.waitForSelector('[data-route]:has-text("About")');
      expect(await page.locator("[data-route]").textContent()).toBe("About");
      expect(await page.locator("[data-loader-data]").textContent()).toBe(
        "About Loader Data"
      );
      expect(await page.locator("title").textContent()).toBe(
        "About Title: About Loader Data"
      );
    });

    test("navigates and calls actions/loaders", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");

      await app.clickSubmitButton("/about");
      await page.waitForSelector('[data-route]:has-text("About")');
      expect(await page.locator("[data-route]").textContent()).toBe("About");
      expect(await page.locator("[data-action-data]").textContent()).toBe(
        "About Action Data"
      );
      expect(await page.locator("[data-loader-data]").textContent()).toBe(
        "About Loader Data"
      );
      expect(await page.locator("title").textContent()).toBe(
        "About Title: About Loader Data"
      );
    });

    test("errors if you call serverLoader", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");

      await app.clickLink("/error");
      await page.waitForSelector("[data-error]");
      expect(await page.locator("[data-error]").textContent()).toBe(
        'Error: You cannot call serverLoader() in SPA Mode (routeId: "routes/error")'
      );
    });

    test("errors if you call serverAction", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");

      await app.clickSubmitButton("/error");
      await page.waitForSelector("[data-error]");
      expect(await page.locator("[data-error]").textContent()).toBe(
        'Error: You cannot call serverAction() in SPA Mode (routeId: "routes/error")'
      );
    });
  });
});
