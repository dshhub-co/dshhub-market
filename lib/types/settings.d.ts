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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
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
export declare const MARKET_SETTINGS_NS = "dshhub-market";
/** The market settings a user may edit at runtime. */
export interface MarketSettings {
    allowRestart: boolean;
}
export declare const MarketSettings: z<MarketSettings>;
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
export declare function installMarketSettings(ctx: Context, resolved: {
    allowRestart?: boolean;
}): void;
