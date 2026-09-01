<p align="center">
  <img src="assets/logo.svg" width="96" alt="dshhub-market logo">
</p>

# dshhub-market

[English](README.md) | 中文

[![npm](https://img.shields.io/npm/v/dshhub-market)](https://www.npmjs.com/package/dshhub-market)
[![stars](https://img.shields.io/github/stars/dshhub-co/dshhub-market?style=flat)](https://github.com/dshhub-co/dshhub-market)
[![CI](https://github.com/dshhub-co/dshhub-market/actions/workflows/ci.yml/badge.svg)](https://github.com/dshhub-co/dshhub-market/actions/workflows/ci.yml)

> 好货都有暗号，输对码上装。

dshhub-market 是装在 DSH（DeepSeek Harness）里的**口令插件市场**：买家输一个 6 位口令，
插件当场解锁装好；创作者把插件上架成口令商品，生成一次性或限时口令，在私域用自己的
方式收款、把口令发给买家。平台提供上架、口令生成与核销统计、买家端市场、更新、皮肤、
备份等一整套能力。由 [DSHHub.co](https://www.dshhub.co) 运营。

## 买家：一个口令输入框

在 DSH 里打开插件市场，首页干干净净，只有一个口令输入框。

没有目录，没有注册，没有广告。买家永远不需要登录，唯一的入口就是那 6 位口令——
比如 `3K7M9P`。口令从哪来？从创作者手里来：他也许在视频、直播间、文章或社群里发码。

试试演示口令 **080808**：输进去，一个皮肤插件当场解锁装好，立刻看到效果。
口令按下去，一切自动发生：插件或插件包解锁、安装、可用，之后更新免费。
整个过程顺得就像在输验证码——因为本来就是照着它做的。

输码即解锁安装，别的都不用管：口令从创作者那里来，不用注册、不用绑定，也不用多走一步。

解锁之后，每张卡片只讲两件事：**谁做的**，和**它有什么用**——作者、寄语、
功能、使用指南、联系方式，一切都围绕「人 + 用处」。

已解锁的都在「我解锁的插件」里，随时回来装、换、卸。解锁过的插件就认准你的
DSH 了：重装、更新都不再扣码。

## 创作者：把插件变成私域变现

创作者从 [dshhub.co](https://www.dshhub.co) 进入，GitHub 授权登录，两条货源任选：

- 从官方精选目录挑插件，上架到自己的橱柜
- 导入自有 GitHub 仓库（公开或私有），或直接扫描本机 DSH 里调好的模式与技能

然后**生成口令**，发到你的私域：

1. 在私域用自己的方式收款——微信、支付宝、Stripe、PayPal、线下，完全由你决定；
2. 把口令发给付款的买家；
3. 买家在 DSH 里输码，插件当场解锁安装。

平台提供核销统计与批次统计：码发到哪、装了几个，一目了然。口令支持
**一次性**（核销即作废，一单一码）和**限时**（T 开头，到期前可多人核销），
可批量生成、导出 TXT，方便贴进你自己的自动发货流程。

生成口令消耗少量积分，积分可随时充值。

## 安装

需要 dsh web 0.1.0-rc.6 或更新版本。

从 npm（推荐，升级最省心）：

