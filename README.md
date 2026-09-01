<p align="center">
  <img src="assets/logo.svg" width="96" alt="dshhub-market logo">
</p>

# dshhub-market

English | [中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/dshhub-market)](https://www.npmjs.com/package/dshhub-market)
[![stars](https://img.shields.io/github/stars/dshhub-co/dshhub-market?style=flat)](https://github.com/dshhub-co/dshhub-market)
[![CI](https://github.com/dshhub-co/dshhub-market/actions/workflows/ci.yml/badge.svg)](https://github.com/dshhub-co/dshhub-market/actions/workflows/ci.yml)

> The good stuff has a code. Enter it, get it.

dshhub-market is the **unlock-with-a-passcode plugin market** inside DSH (DeepSeek Harness): buyers enter a 6-character passcode and the plugin installs itself on the spot; creators list their plugins as passcode products, generate one-time or time-limited codes, and sell them in their own private channels, collecting payment **however they like**. The platform brings the whole package: listing, passcode generation with redemption stats, the buyer-side market, updates, skins, and backups. Run by [DSHHub.co](https://www.dshhub.co).

## For buyers: one passcode box

Open the plugin market inside DSH and the home screen holds exactly one thing — a small box for a six-character code.

No catalog, no sign-up, no ads. As a buyer you never log in anywhere; the only door is the code itself, something like `3K7M9P`. Where does the code come from? From the creator: a video, a livestream, an article, or a community.

Try the demo code **080808**: a skin plugin unlocks and installs itself on the spot and you see the effect immediately. Press Enter and everything just happens — the plugin, or a whole pack, unlocks, installs and is ready to use. Updates are free from then on. It feels like typing a verification code, because it's built to.

Entering a code unlocks and installs — that's all there is to it. You got the code from the creator; no account, no sign-up, no extra steps.

Once unlocked, each card talks about two things only: **who made it** and **what it's for** — the author, a note from them, what it does, a short guide, and how to reach them. No ads, no noise.

Everything you've unlocked sits in "My unlocked plugins," ready to install, switch, or remove any time. Unlocked plugins remember your DSH: reinstall and update without burning the code again.

## For creators: turn your plugin into private-channel income

Creators work from [dshhub.co](https://www.dshhub.co), signed in with their GitHub account. Two ways to stock your shelf:

- Pick a plugin from the official curated catalog
- Import your own GitHub repository (public or private), or scan the presets & skills tuned in your local DSH

Then **generate passcodes** and distribute them in your private channels:

1. Collect payment your way — WeChat, Alipay, Stripe, PayPal, cash, whatever you like;
2. Send the passcode to the paying buyer;
3. The buyer enters the code in DSH and the plugin unlocks and installs on the spot.

The platform shows you redemption stats and per-batch breakdowns, so you always know which code reached how many people. Passcodes come in two flavors: **one-time** (void after a single redemption — one order, one code) and **time-limited** (start with T, redeemable by multiple users before expiry). Bulk generation and TXT export make it easy to drop codes into your own auto-delivery flow.

Generating a passcode costs a small number of points — top up whenever you need more.

## Quick start: 4 steps, try a passcode

**Step 1 — Install DeepSeek Harness (if you haven't)**

Paste this into your terminal. The wizard checks Node.js, pnpm and DSH on your machine and walks you through anything that's missing:

```sh
curl -fsSL https://www.dshhub.co/install.sh -o dshhub-install.sh && bash dshhub-install.sh
```

**Step 2 — Install the passcode marketplace**

```sh
dsh plugin --profile web add dshhub-market
```

**Step 3 — Restart DSH and open the market**

Restart `dsh web`, then open **Settings → Plugin Market**.

**Step 4 — Try a passcode**

Enter the demo code **080808** — a skin plugin unlocks and installs itself on the spot.

When a buyer gets a passcode from you, they do the same final step: open the market, enter the code, and the plugin installs. No account, no sign-up.

## Install options (advanced)

Requires dsh web 0.1.0-rc.6 or newer. Besides the official wizard above, you can also install with any of these:

Requires dsh web 0.1.0-rc.6 or newer.

From npm (recommended — smoothest upgrades):

```sh
dsh plugin --profile web add dshhub-market
```

Or a pinned version from DSHHub.co (versioned links never change, so lockfile checksums stay stable):

```sh
dsh plugin --profile web add https://www.dshhub.co/dshhub-market-0.8.51.tgz
```

Or from GitHub:

```sh
dsh plugin --profile web add github:dshhub-co/dshhub-market
```

Restart `dsh web`, then open **Settings → Plugin Market**.

> Note: if you install from the website versioned link, run `pnpm install --update-checksums` in the profile directory after each release (the link points at the latest tarball, so the lockfile checksum needs a refresh). GitHub installs work out of the box, with no build scripts to allow.
>
> On an older host the market disables itself and says so in the browser console — if the Plugin Market entry never appears, that's usually why.

## Under the hood

As a market app it also carries these real capabilities:

- **Passcode unlock & install** — enter a code, it installs; sources are validated against the DSHHub.co registry allowlist
- **Theme skins** — apply instantly, no restart
- **Update / uninstall** — two-step confirm against accidents
- **Hot disable / enable** — takes effect in about a second, survives reboots
- **Backup & restore** — daily auto-backup to WebDAV, or sync across machines via a private Gist
- **Diagnostics** — load order and conflicts on one page
- **Load order management** — drag to reorder, validated before anything is written
- **AI fix hints** — one click copies a diagnostics-driven repair prompt
- **Sanitized log export** — bug reports carry the version, private details masked

## Security

- Installs are restricted to sources in the DSHHub.co registry — anything else is rejected
- Code from private repositories never enters the public catalog — it passes through the platform only when a buyer redeems a code
- Build scripts stay blocked by default; allowing one is your explicit choice
- The install endpoint accepts same-origin requests only
- The local bridge for dshhub.co accepts loopback and dshhub.co origins only
- Clear warnings before backup export; logs are sanitized throughout

## Fork

This is a fork of [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market) (MIT license, copyright retained) with the same market engine. Differences: rebranded as `dshhub-market`, with the registry and self-update channel pointing at [DSHHub.co](https://www.dshhub.co). The full change list and resync procedure live in [UPSTREAM.md](UPSTREAM.md).

## Feedback

Bugs go in [issues](https://github.com/dshhub-co/dshhub-market/issues) — attaching the market's exported log makes diagnosis about ten times faster. Feature ideas are welcome too; say what you're planning before a big PR, so two people don't build the same thing twice.

Note: this repository is the market app itself, not the catalog. The plugin list is served by dshhub.co — list your work there, and please don't open PRs for plugin entries here.

## Data source

Live from [www.dshhub.co/api/registry/plugins.json](https://www.dshhub.co/api/registry/plugins.json), with a bundled snapshot as offline fallback.

## License

MIT · fork of [dsh-market](https://github.com/dsh-market/dsh-market) · [dshhub.co](https://www.dshhub.co)
