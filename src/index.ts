/**
 * dsh-market host entry: mounts the market's HTTP routes once the profile
 * composes the webServer and shell services.
 */

import type { Context } from '@deepseek-ai/cordis'
import { createDesktopPluginRuntime, type DesktopPnpmLike } from './dsh-cli.ts'
import { mountMarketRoutes, type MarketConfig, type MarketHost } from './routes.ts'
import { installMarketSettings } from './settings.ts'
import { startBridge } from './bridge.ts'
import { startCloudBridge } from './cloud-bridge.ts'
import { scheduleSelfUpdate } from './self-update.ts'
import type { AgentsServiceLike } from './agents.ts'

export const name = 'dshhub-market'

/** Optional cordis.yml configuration; profile defaults to `web`. */
export type Config = Partial<Pick<MarketConfig, 'profile' | 'allowRestart'>>

/** Structural subset of DSH Desktop's public `desktopProfiles` contract. */
interface DesktopProfilesLike {
  readonly current: {
    readonly name: string
    readonly dir: string
  }
}

interface MarketEffectHost extends MarketHost {
  effect(
    callback: () => (() => void | Promise<void>),
    label: string,
  ): void
}

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
function argvProfile(): string | undefined {
  const argv = process.argv
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) return argv[flag + 1]
  return undefined
}

/**
 * Resolve the host's `agents` inventory lazily — at request time, not at
 * market startup, so the guard sees whichever agents exist by the time an
 * update is asked for. Hosts without the service return undefined and the
 * update route stays open (see src/agents.ts).
 */
function agentsLookupOf(ctx: Context): () => AgentsServiceLike | undefined {
  return () => ctx.get('agents') as AgentsServiceLike | undefined
}

export function apply(ctx: Context, config?: Config): void {
  ctx.inject(['webServer', 'loader'], (hostCtx: Context) => {
    const host = hostCtx as unknown as MarketEffectHost
    const desktopProfiles = ctx.get('desktopProfiles') as DesktopProfilesLike | undefined
    if (desktopProfiles === undefined) {
      const resolved: MarketConfig = {
        profile: config?.profile ?? argvProfile() ?? 'web',
        allowRestart: config?.allowRestart ?? true,
      }
      // Offer allowRestart as a switch on the settings page. Deliberately
      // NOT in the Desktop branch below: there the shell owns the process
      // lifecycle and the value is forced false, so it is not the user's to
      // choose. No-ops on a host without a settings service.
      installMarketSettings(ctx, resolved)
      // fork: the official dshmarket mounts the SAME /dsh-market/* routes;
      // when both are installed in one profile the webserver rejects the
      // duplicate registration and the throw would take the bridge and
      // self-update down with it. Degrade instead: the routes stay with
      // whichever market mounted them first, everything else keeps running.
      try {
        host.effect(() => mountMarketRoutes(host, resolved, undefined, agentsLookupOf(ctx)), 'dshhub-market: http routes')
      } catch (error) {
        console.warn(`[dshhub-market] /dsh-market/* routes not mounted (another market plugin already owns them, e.g. official dshmarket): ${error instanceof Error ? error.message : String(error)} — run: dsh plugin --profile ${resolved.profile} remove dshmarket`)
      }
      // fork: website one-click install bridge (DSHHUB_DISABLE_BRIDGE=1 to
      // opt out) and tarball self-update (DSHHUB_DISABLE_AUTOUPDATE=1).
      if (process.env.DSHHUB_DISABLE_BRIDGE !== '1') void startBridge(resolved.profile)
      // fork: cloud publish channel — browser never talks to 127.0.0.1; the
      // bridge registers with the platform and polls its task queue instead
      // (DSHHUB_DISABLE_BRIDGE=1 opts out of this too).
      if (process.env.DSHHUB_DISABLE_BRIDGE !== '1') void startCloudBridge(resolved.profile)
      scheduleSelfUpdate(resolved.profile)
      return
    }

    // Desktop's supported cross-environment contract guarantees that
    // desktopProfiles exists before Loader entries mount, and prescribes this
    // presence check plus a nested desktopPnpm injection:
    // https://github.com/anywhere-labs/deepseek-harness-desktop/blob/4f68147091e585aaa1d815f99d30a657b3842d7c/dsh-plugin-desktop/docs/plugin-services.md#L190-L243
    // Ordinary DSH keeps the existing CLI path above.
    hostCtx.inject(['desktopPnpm'], (desktopCtx: Context) => {
      const current = desktopProfiles.current
      const service = (desktopCtx as unknown as { desktopPnpm: DesktopPnpmLike }).desktopPnpm
      const runtime = createDesktopPluginRuntime(service, current.dir)
      const resolved: MarketConfig = {
        profile: current.name,
        profileDirectory: current.dir,
        // Relaunching a raw Electron process would bypass Desktop's launcher
        // lifecycle. The shell remains responsible for restart in this mode.
        allowRestart: false,
      }
      const desktopHost = desktopCtx as unknown as MarketEffectHost
      try {
        desktopHost.effect(() => {
          const disposeRoutes = mountMarketRoutes(host, resolved, runtime, agentsLookupOf(ctx))
          return async () => {
            disposeRoutes()
            await runtime.dispose()
          }
        }, 'dshhub-market: Desktop http routes and package operations')
      } catch (error) {
        console.warn(`[dshhub-market] /dsh-market/* routes not mounted (another market plugin already owns them): ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  })
}
