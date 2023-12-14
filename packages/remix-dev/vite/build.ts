import type * as Vite from "vite";
import path from "node:path";
import fse from "fs-extra";
import colors from "picocolors";

import type {
  ResolvedRemixVitePluginConfig,
  ServerBuildConfig,
} from "./plugin";
import type { ConfigRoute, RouteManifest } from "../config/routes";
import invariant from "../invariant";

async function extractRemixPluginConfig({
  configFile,
  mode,
  root,
}: {
  configFile?: string;
  mode?: string;
  root: string;
}) {
  let vite = await import("vite");

  // Leverage the Vite config as a way to configure the entire multi-step build
  // process so we don't need to have a separate Remix config
  let viteConfig = await vite.resolveConfig(
    { mode, configFile, root },
    "build"
  );

  let pluginConfig = viteConfig[
    "__remixPluginResolvedConfig" as keyof typeof viteConfig
  ] as ResolvedRemixVitePluginConfig | undefined;
  if (!pluginConfig) {
    console.error(colors.red("Remix Vite plugin not found in Vite config"));
    process.exit(1);
  }

  return { pluginConfig, viteConfig };
}

function getLeafRoutes(routes: RouteManifest): ConfigRoute[] {
  let parentIds = new Set<string>();
  for (let id in routes) {
    let { parentId } = routes[id];
    if (typeof parentId === "string") {
      parentIds.add(parentId);
    }
  }

  let leafRoutes = [];
  for (let id in routes) {
    if (!parentIds.has(id)) {
      leafRoutes.push(routes[id]);
    }
  }

  return leafRoutes;
}

function getRouteMatches(routes: RouteManifest, routeId: string) {
  let result: ConfigRoute[] = [];
  let currentRouteId: string | undefined = routeId;

  while (currentRouteId) {
    invariant(routes[currentRouteId], `Missing route for ${currentRouteId}`);
    result.push(routes[currentRouteId]);
    currentRouteId = routes[currentRouteId].parentId;
  }

  return result.reverse();
}

function getServerBundles({
  routes,
  serverBuildDirectory,
  serverBundleDirectory: getServerBundleDirectory,
}: ResolvedRemixVitePluginConfig): ServerBuildConfig[] {
  if (!getServerBundleDirectory) {
    return [{ routes, serverBuildDirectory }];
  }

  let serverBundles = new Map<string, ServerBuildConfig>();

  for (let route of getLeafRoutes(routes)) {
    let matches = getRouteMatches(routes, route.id);

    let serverBundleDirectory = path.join(
      serverBuildDirectory,
      getServerBundleDirectory({ route, matches })
    );

    let serverBuildConfig = serverBundles.get(serverBundleDirectory);
    if (!serverBuildConfig) {
      serverBuildConfig = {
        routes: {},
        serverBuildDirectory: serverBundleDirectory,
      };
      serverBundles.set(serverBundleDirectory, serverBuildConfig);
    }
    for (let match of matches) {
      serverBuildConfig.routes[match.id] = match;
    }
  }

  return Array.from(serverBundles.values());
}

async function cleanServerBuildDirectory(
  viteConfig: Vite.ResolvedConfig,
  { rootDirectory, serverBuildDirectory }: ResolvedRemixVitePluginConfig
) {
  let isWithinRoot = () => {
    let relativePath = path.relative(rootDirectory, serverBuildDirectory);
    return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
  };

  if (viteConfig.build.emptyOutDir ?? isWithinRoot()) {
    await fse.remove(serverBuildDirectory);
  }
}

export interface ViteBuildOptions {
  assetsInlineLimit?: number;
  clearScreen?: boolean;
  config?: string;
  emptyOutDir?: boolean;
  force?: boolean;
  logLevel?: Vite.LogLevel;
  minify?: Vite.BuildOptions["minify"];
  mode?: string;
}

export async function build(
  root: string,
  {
    assetsInlineLimit,
    clearScreen,
    config: configFile,
    emptyOutDir,
    force,
    logLevel,
    minify,
    mode,
  }: ViteBuildOptions
) {
  let { pluginConfig, viteConfig } = await extractRemixPluginConfig({
    configFile,
    mode,
    root,
  });

  let vite = await import("vite");

  async function viteBuild(serverBuildConfig?: ServerBuildConfig) {
    let ssr = Boolean(serverBuildConfig);
    await vite.build({
      root,
      mode,
      configFile,
      build: { assetsInlineLimit, emptyOutDir, minify, ssr },
      optimizeDeps: { force },
      clearScreen,
      logLevel,
      ...(serverBuildConfig
        ? { __remixServerBuildConfig: serverBuildConfig }
        : {}),
    });
  }

  // Since we're running multiple Vite server builds with different output
  // directories based on your route config, we need to clean the root server
  // build directory ourselves rather than relying on Vite to do it, otherwise
  // you can end up with stale server bundles in your build output
  await cleanServerBuildDirectory(viteConfig, pluginConfig);

  // Run the Vite client build first
  await viteBuild();

  // Then run Vite SSR builds in parallel
  let serverBundles = getServerBundles(pluginConfig);
  await Promise.all(serverBundles.map(viteBuild));
}
