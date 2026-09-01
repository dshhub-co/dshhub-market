/**
 * dsh-market host entry: mounts the market's HTTP routes once the profile
 * composes the webServer and shell services.
 */
import { createDesktopPluginRuntime } from './dsh-cli.js';
import { mountMarketRoutes } from './routes.js';
import { installMarketSettings } from './settings.js';
import { startBridge } from './bridge.js';
import { scheduleSelfUpdate } from './self-update.js';
export const name = 'dshhub-market';
/**
 * Register the market against the host context.
 * @param ctx - Host context that may acquire webServer and shell services.
 * @param config - Optional profile override from the loader.
 */
/**
 * The profile this host process actually booted (`--profile <name>` on the
 * dsh CLI invocation). Without it the market would default to `web` and
 * installs from a test/secondary profile would mutate the real one.
 */
function argvProfile() {
    const argv = process.argv;
    const flag = argv.indexOf('--profile');
    if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-'))
        return argv[flag + 1];
    return undefined;
}
/**
 * Resolve the host's `agents` inventory lazily — at request time, not at
 * market startup, so the guard sees whichever agents exist by the time an
 * update is asked for. Hosts without the service return undefined and the
 * update route stays open (see src/agents.ts).
 */
function agentsLookupOf(ctx) {
    return () => ctx.get('agents');
}
export function apply(ctx, config) {
    ctx.inject(['webServer', 'loader'], (hostCtx) => {
        const host = hostCtx;
        const desktopProfiles = ctx.get('desktopProfiles');
        if (desktopProfiles === undefined) {
            const resolved = {
                profile: config?.profile ?? argvProfile() ?? 'web',
                allowRestart: config?.allowRestart ?? true,
            };
            // Offer allowRestart as a switch on the settings page. Deliberately
            // NOT in the Desktop branch below: there the shell owns the process
            // lifecycle and the value is forced false, so it is not the user's to
            // choose. No-ops on a host without a settings service.
            installMarketSettings(ctx, resolved);
            // fork: the official dshmarket mounts the SAME /dsh-market/* routes;
            // when both are installed in one profile the webserver rejects the
            // duplicate registration and the throw would take the bridge and
            // self-update down with it. Degrade instead: the routes stay with
            // whichever market mounted them first, everything else keeps running.
            try {
                host.effect(() => mountMarketRoutes(host, resolved, undefined, agentsLookupOf(ctx)), 'dshhub-market: http routes');
            }
            catch (error) {
                console.warn(`[dshhub-market] /dsh-market/* routes not mounted (another market plugin already owns them, e.g. official dshmarket): ${error instanceof Error ? error.message : String(error)} — run: dsh plugin --profile ${resolved.profile} remove dshmarket`);
            }
            // fork: website one-click install bridge (DSHHUB_DISABLE_BRIDGE=1 to
            // opt out) and tarball self-update (DSHHUB_DISABLE_AUTOUPDATE=1).
            if (process.env.DSHHUB_DISABLE_BRIDGE !== '1')
                void startBridge(resolved.profile);
            // fork: cloud publish channel — 不再随插件自动启动（0.8.56 起改为
            // 市场界面驱动：打开市场界面才轮询，关闭即停止，见 /dsh-market/bridge-control）。
            scheduleSelfUpdate(resolved.profile);
            return;
        }
        // Desktop's supported cross-environment contract guarantees that
        // desktopProfiles exists before Loader entries mount, and prescribes this
        // presence check plus a nested desktopPnpm injection:
        // https://github.com/anywhere-labs/deepseek-harness-desktop/blob/4f68147091e585aaa1d815f99d30a657b3842d7c/dsh-plugin-desktop/docs/plugin-services.md#L190-L243
        // Ordinary DSH keeps the existing CLI path above.
        hostCtx.inject(['desktopPnpm'], (desktopCtx) => {
            const current = desktopProfiles.current;
            const service = desktopCtx.desktopPnpm;
            const runtime = createDesktopPluginRuntime(service, current.dir);
            const resolved = {
                profile: current.name,
                profileDirectory: current.dir,
                // Relaunching a raw Electron process would bypass Desktop's launcher
                // lifecycle. The shell remains responsible for restart in this mode.
                allowRestart: false,
            };
            const desktopHost = desktopCtx;
            try {
                desktopHost.effect(() => {
                    const disposeRoutes = mountMarketRoutes(host, resolved, runtime, agentsLookupOf(ctx));
                    return async () => {
                        disposeRoutes();
                        await runtime.dispose();
                    };
                }, 'dshhub-market: Desktop http routes and package operations');
            }
            catch (error) {
                console.warn(`[dshhub-market] /dsh-market/* routes not mounted (another market plugin already owns them): ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    });
}
