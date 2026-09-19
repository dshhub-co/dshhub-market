/**
 * The market's own settings namespace: the half that makes `allowRestart`
 * a switch on the plugin configuration page instead of a line the user has
 * to hand-write into cordis.yml.
 *
 * `allowRestart: false` is the documented answer for a host owned by
 * systemd, launchd or pm2 — a supervisor restarts it, so the market's
 * one-click restart must not launch a second one. Until now the only way to
 * say that was editing YAML in the right place with the right indentation,
 * where a stray space stops the profile booting.
 *
 * Only `allowRestart` is exposed. `profile` names which profile this
 * instance manages: it is decided at mount from the composition or the
 * command line, and a running instance cannot switch to another one, so
 * offering it as a field would promise something the write cannot deliver.
 *
 * The release channel is NOT here either, and that is a correction rather
 * than an omission. It was, briefly, and it made this namespace a second
 * writer for a value the market already stores in its own state.json: the
 * mount read the user's saved channel off disk, then the change hook
 * assigned `source().channel` — which knows nothing about that file —
 * straight back over it. The choice survived exactly until the next
 * settings event.
 *
 * Only a real host could show that; the unit lane mounts the routes without
 * this layer at all. `allowRestart` needs this door because its only other
 * one is hand-edited YAML. The channel has a control of its own on the
 * plugin configuration page, so a second door bought nothing and cost the
 * setting its memory.
 *
 * WHY THE WIRING IS SELF-HELD INSTEAD OF CALLING AN UPSTREAM HELPER
 * -----------------------------------------------------------------
 * Up to 0.1.0-rc.7 the host exported two free functions — `settingsNamespace()`
 * (which branded the namespace) and `installSettingsSection()` (which rode the
 * scoped fiber and drove the source/change hooks). This module imported both by
 * name. The 0.1.5-rc.2 host deleted them: its `lib/index.js` now exports only
 * `SettingsConflictError`, `SettingsProvider` (also default) and
 * `redactSecrets`. An ESM named import of an export that no longer exists is
 * not a runtime `undefined` — it is a SyntaxError at module instantiation, so
 * the whole plugin package fails to load and `dsh web` dies before a single
 * route mounts. That is the bug this file exists to fix.
 *
 * Importing the CURRENT API instead would not be a fix either: the peer range
 * straddles hosts that have the old free functions and hosts that have the new
 * `SettingsProvider#installSection` method, so either static import fails hard
 * on the other half of the range.
 *
 * What is stable across that whole range is `SettingsProvider#register(ns,
 * schema, { base, validate })` and the `{ get(), watch(cb) }` scope it returns
 * (verified byte-for-byte identical in both shipped versions; the newer one only
 * adds a namespace-pattern check). So the wiring is reimplemented here against a
 * structural subset of the host service, using only that stable contract.
 * Structural, not imported, on purpose: a future rename of
 * `SettingsProvider`/`SettingsScope` must not be able to take the package down
 * the same way again.
 *
 * The `settings` service is still requested as an OPTIONAL injection
 * (`ctx.inject(['settings'], …)`), so a host with no settings service — every
 * dsh before 0.1.0-rc.7 — simply never runs any of this and the entry
 * configuration stands as composed. That is why this needs no version check of
 * its own.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/**
 * Namespace the card on the browser side keys itself to.
 *
 * A plain kebab-case string, NOT a branded value: both ends of the supported
 * host range validate a namespace with `NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/`,
 * and the free `settingsNamespace()` factory that used to brand it was removed
 * in 0.1.5-rc.2. `'dshhub-market'` passes that pattern on both, so the literal
 * is what this module can honestly claim; a comment, not a call, is what keeps
 * it aligned with the host.
 */
export const MARKET_SETTINGS_NS = 'dshhub-market'

/** The market settings a user may edit at runtime. */
export interface MarketSettings {
  allowRestart: boolean
}

export const MarketSettings: z<MarketSettings> = z.object({
  allowRestart: z.boolean().default(true),
})

/**
 * A watched scope handed back by {@link SettingsServiceLike.register}.
 *
 * Structural subset of the host's `SettingsScope`: only the two members this
 * module touches. `get()` returns the resolved section (the schema default
 * merged with the composed base and whatever the host has saved), and
 * `watch(cb)` fires `cb` on every accepted change.
 */
interface SettingsScopeLike {
  get(): MarketSettings
  watch(callback: () => void): () => void
}

/**
 * Structural subset of the host settings service.
 *
 * Deliberately NOT `import type { SettingsProvider }`: the host owns the type,
 * and 0.1.5-rc.2 already reshaped the surface around it once. Describing only
 * `register(ns, schema, { base })` keeps this package compiling and loading
 * against any host whose runtime contract still matches, without coupling to the
 * upstream type graph.
 */
interface SettingsServiceLike {
  register(
    ns: string,
    schema: z<MarketSettings>,
    options: { base: MarketSettings },
  ): SettingsScopeLike
}

/**
 * Whether the fiber that owns `ctx` is tearing down rather than merely losing
 * the `settings` service.
 *
 * Read structurally (`ctx.fiber?.state`) so this never hard-depends on a private
 * fiber type: `DISPOSED = 4` and `UNLOADING = 5` are the two FiberState members
 * that mark teardown, the same values the host's own helper compares against.
 *
 * @param ctx - the context whose owning fiber is inspected.
 * @returns true while that fiber is unloading or already disposed.
 */
function isUnloading(ctx: unknown): boolean {
  const state = (ctx as { fiber?: { state?: unknown } }).fiber?.state
  return state === 4 || state === 5
}

/**
 * Wire the namespace so a saved change reaches the routes immediately.
 *
 * The routes read `allowRestart` off this object on every request (the
 * status route reports the capability, the restart route enforces it), so
 * updating it in place is what makes a toggle take effect without a
 * restart — which would be a poor thing to require of a setting whose whole
 * subject is restarting.
 *
 * Registration rides the scoped fiber created by `ctx.inject(['settings'], …)`,
 * so a host without the service never registers anything and everything else
 * mounts unchanged.
 *
 * @param ctx - the plugin context owning the wiring.
 * @param resolved - the live config object the routes read.
 */
export function installMarketSettings(ctx: Context, resolved: { allowRestart?: boolean }): void {
  // `!== false` is the routes' own reading: an absent value allows restart,
  // so the entry layer this registers must say the same thing rather than
  // presenting "unset" as "off".
  const entry = { allowRestart: resolved.allowRestart !== false }
  // Fallback source: the composed entry, used until a host scope is available
  // and again if the service ever goes away.
  let source = (): MarketSettings => entry
  ctx.inject(['settings'], (sctx: Context) => {
    const settings = (sctx as unknown as { settings: SettingsServiceLike }).settings
    const scope = settings.register(MARKET_SETTINGS_NS, MarketSettings, { base: entry })
    source = () => scope.get()
    // Disposer for the scoped fiber. Two exits:
    //   * the whole plugin is unloading — leave the live value alone; writing a
    //     fallback during teardown is exactly the "dirty write" the old helper
    //     guarded against with the same fiber-state check;
    //   * only the service disappeared — fall back to the composed entry and
    //     publish it, so the routes stop reporting a setting nothing backs.
    sctx.effect(() => () => {
      if (isUnloading(ctx)) return
      source = () => entry
      resolved.allowRestart = source().allowRestart
    })
    // Publish the host's resolved value (base merged with the saved section)
    // onto the live config the routes read. Assigns ONLY what this namespace
    // owns — writing back a field the market stores elsewhere is how the
    // channel lost its memory.
    resolved.allowRestart = source().allowRestart
    // Every accepted change re-reads the scope; the routes see it on the next
    // request, no restart required.
    scope.watch(() => {
      if (isUnloading(ctx)) return
      resolved.allowRestart = source().allowRestart
    })
  })
}
