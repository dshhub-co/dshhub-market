<p align="center">
  <img src="assets/logo.svg" width="96" alt="dshhub-market logo">
</p>

# dshhub-market

English | [中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/dshhub-market)](https://www.npmjs.com/package/dshhub-market)
[![stars](https://img.shields.io/github/stars/dshhub-co/dshhub-market?style=flat)](https://github.com/dshhub-co/dshhub-market)
[![CI](https://github.com/dshhub-co/dshhub-market/actions/workflows/ci.yml/badge.svg)](https://github.com/dshhub-co/dshhub-market/actions/workflows/ci.yml)

> The good stuff has a code. Enter it, get it.

dshhub-market is the unlock-with-a-code plugin market inside DSH (DeepSeek Harness). Buyers enter a code and the plugin installs itself; creators hand out codes in their own channels and get their best work into the right hands; free plugins find their people too. Run by [DSHHub.co](https://www.dshhub.co).

## What you see

Picture it: you open the plugin market inside DSH, and the homepage holds exactly one thing — a small box for a six-digit code.

No catalog. No recommendations. No sign-up. As a buyer you never log in anywhere; the only door is the code itself, something like 3K7M9P.

Try the demo code **080808**: a skin plugin unlocks and installs itself on the spot, and you see the effect immediately. Consider it a handshake.

Press Enter and everything just happens: the plugin — or a whole pack of them — unlocks, installs, and is ready to use. Updates are free from then on. It feels like typing a verification code, because it's built to. Unlocking only installs — no payment is involved.

Once unlocked, each card talks about two things only: who made it, and what it's for. Who's behind it, a note from them, what it does, an install button, a short guide, how to reach the author — everything orbits a person and their work. No ads, no noise.

Everything you've unlocked sits in "My unlocked plugins," ready to install, switch, or remove any time. Unlocked plugins remember your DSH: reinstall and update without burning the code again.

## What you get as a creator

Creators work from [dshhub.co](https://www.dshhub.co), signed in with their GitHub account. Two ways to stock your shelf:

- Pick a plugin from the official curated catalog
- Import your own GitHub repository — public or private

Then generate a code and hand it out anywhere your people are: a video, a livestream, an article. Anyone who enters it gets the plugin installed on the spot. The platform shows you redemption stats and per-batch breakdowns, so you always know which code reached how many people. A code dies at redemption; until then it can be passed along — perfect for your distribution partners.

What you're really offering isn't source code — it's teaching, answering questions, being there for people. The plugins are free; what the code pays for is the person behind them. The platform takes zero cut for now, and any future pricing will be announced well ahead of time.

## Install

Requires dsh web 0.1.0-rc.6 or newer.

From npm:

```sh
dsh plugin --profile web add dshhub-market
```

Or a pinned version from DSHHub.co (versioned links never change, so lockfile checksums stay stable):

```sh
dsh plugin --profile web add https://www.dshhub.co/dshhub-market-0.8.2.tgz
```

Or from GitHub:

```sh
dsh plugin --profile web add github:dshhub-co/dshhub-market
```

Restart `dsh web`, then open **Settings → Plugin Market**.

Prefer the npm name — upgrades are smoothest that way. If you install from the website URL, run `pnpm install --update-checksums` in the profile directory after each release (the URL serves the latest tarball, so the lockfile checksum needs a refresh). GitHub installs work out of the box, with no build scripts to allow.

On an older host the market disables itself and says so in the browser console — if the Plugin Market entry never appears, that's usually why. A desktop build may bundle a dsh older than the one npm would give you.

## Under the hood

As a market app it also carries these real capabilities:

- **One-click install** — confirm the source, watch live progress; most plugins are ready after a refresh
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
- Code from private repositories never enters the public catalog — it passes through the platform only when a fan redeems a code
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
