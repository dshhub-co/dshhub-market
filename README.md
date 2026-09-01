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

## Install

Requires dsh web 0.1.0-rc.6 or newer.

From npm (recommended — smoothest upgrades):

