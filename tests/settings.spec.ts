/**
 * The market's own settings section: what makes `allowRestart` a switch on
 * the plugin configuration page instead of a hand-edited YAML line.
 *
 * Only what a unit can honestly decide lives here: the schema's defaults,
 * that the settings service is an OPTIONAL injection so a host without one
 * (every dsh before 0.1.0-rc.7) mounts everything else unchanged, and that
 * the wiring talks to the host through the one contract stable across the
 * supported range (`register` + `scope.get/watch`).
 *
 * Whether the namespace actually reaches a real host is asserted in layer 3
 * against real dsh, not against a hand-written stand-in of the settings
 * service — a fake would only prove this code agrees with my reading of a
 * contract I did not write.
 */

import { describe, expect, it } from 'vitest'
import { installMarketSettings, MarketSettings } from '../src/settings.ts'

/**
 * Minimal cordis stand-in.
 *
 * `inject` writes down every dependency request and only invokes the callback
 * when the service is present — a faithful mirror of the optional injection,
 * which is what lets the "no settings service" case assert that nothing is
 * registered. When present, the fake's `register` records the namespace and the
 * base it was handed, and returns a scope whose `get()` reflects that base (the
 * real provider resolves the schema default over `base`); `setScope`/`fireWatch`
 * let a test drive a change the way a saved write would.
 */
function fakeContext(hasSettings: boolean) {
  const injected: string[][] = []
  const registrations: { ns: string; base: { allowRestart: boolean } }[] = []
  let scope: { allowRestart: boolean } = { allowRestart: true }
  let watcher: (() => void) | null = null

  const ctx = {
    injected,
    registrations,
    inject(services: string[], callback: (scoped: unknown) => void) {
      injected.push(services)
      if (hasSettings && services.includes('settings')) callback(ctx)
    },
    settings: hasSettings
      ? {
          register(ns: string, _schema: unknown, options: { base: { allowRestart: boolean } }) {
            registrations.push({ ns, base: options.base })
            scope = { ...options.base }
            return {
              get: () => scope,
              watch: (callback: () => void) => { watcher = callback; return () => {} },
            }
          },
        }
      : undefined,
    // The real fiber runs the effect body at once and keeps its disposer; a
    // stand-in that drops the disposer is enough for the mount path.
    effect: (run: () => unknown) => { run() },
    on: () => () => {},
  }

  return {
    ctx,
    /** Replace the scope's resolved value, then fire the change watcher. */
    setScope(next: { allowRestart: boolean }) {
      scope = next
    },
    fireWatch() {
      watcher?.()
    },
  }
}

describe('MarketSettings schema', () => {
  it('defaults allowRestart to on', () => {
    expect(MarketSettings({}).allowRestart).toBe(true)
  })

  it('accepts an explicit off', () => {
    expect(MarketSettings({ allowRestart: false }).allowRestart).toBe(false)
  })

  it('claims only what this namespace actually stores', () => {
    // The release channel was in here for one version, and it made this a
    // SECOND writer for a value that lives in the market's state.json. The
    // routes read the saved channel off disk at mount and the change hook —
    // which cannot see that file — assigned its own idea of the field straight
    // back over it, so the user's choice survived until the next settings
    // event and no further.
    //
    // A schema field is a claim of ownership, so this asserts the claim
    // stays narrow — widening it silently is exactly how that happened.
    // The consequence itself is caught in layer 3 (tests/web/channel.e2e.ts)
    // against a real settings service, per this file's own rule about not
    // hand-writing a stand-in for a contract we did not author.
    expect(Object.keys(MarketSettings({}))).toEqual(['allowRestart'])
  })
})

describe('installMarketSettings', () => {
  it('asks for the settings service optionally, never as a hard dependency', () => {
    const { ctx } = fakeContext(false)
    installMarketSettings(ctx as never, { allowRestart: true })
    // A host without the service must still mount everything else: the
    // registration rides its own scoped fiber.
    expect(ctx.injected.flat()).toContain('settings')
    expect(ctx.injected.flat()).not.toContain('webServer')
  })

  it('registers nothing when the host has no settings service', () => {
    const { ctx } = fakeContext(false)
    installMarketSettings(ctx as never, { allowRestart: true })
    // The optional-injection branch is never entered on such a host, so no
    // namespace is claimed and nothing can throw.
    expect(ctx.registrations).toHaveLength(0)
  })

  it('registers the namespace once, over the composed entry value', () => {
    const { ctx } = fakeContext(true)
    const resolved = { allowRestart: false }
    installMarketSettings(ctx as never, resolved)
    expect(ctx.registrations).toHaveLength(1)
    expect(ctx.registrations[0].ns).toBe('dshhub-market')
    // The base carries the composed value, so the schema never presents the
    // entry "off" as merely unset.
    expect(ctx.registrations[0].base.allowRestart).toBe(false)
    // The host resolved section is what drives the live config, so a composed
    // `false` stays `false` after mount.
    expect(resolved.allowRestart).toBe(false)
  })

  it('normalizes an absent allowRestart to on at the entry layer', () => {
    const { ctx } = fakeContext(true)
    const resolved: { allowRestart?: boolean } = {}
    installMarketSettings(ctx as never, resolved)
    expect(ctx.registrations[0].base.allowRestart).toBe(true)
    expect(resolved.allowRestart).toBe(true)
  })

  it('follows the scope when a saved change arrives', () => {
    const { ctx, setScope, fireWatch } = fakeContext(true)
    const resolved = { allowRestart: true }
    installMarketSettings(ctx as never, resolved)
    expect(resolved.allowRestart).toBe(true)
    // A saved write lands in the scope and the watcher republishes it.
    setScope({ allowRestart: false })
    fireWatch()
    expect(resolved.allowRestart).toBe(false)
    // ...and back again, so the direction is not the assertion.
    setScope({ allowRestart: true })
    fireWatch()
    expect(resolved.allowRestart).toBe(true)
  })
})
