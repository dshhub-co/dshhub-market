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
插件当场解锁装好；创作者把插件上架成口令商品，在私域用**自己任何收款方式**卖给粉丝——
平台只负责口令的生成与核销，不碰你的定价与收款。由 [DSHHub.co](https://www.dshhub.co) 运营。

## 买家：一个口令输入框

在 DSH 里打开插件市场，首页干干净净，只有一个口令输入框。

没有目录，没有注册，没有广告。买家永远不需要登录，唯一的入口就是那 6 位口令——
比如 `3K7M9P`。口令从哪来？从创作者手里来：他也许在视频、直播间、文章或社群里发码。

试试演示口令 **080808**：输进去，一个皮肤插件当场解锁装好，立刻看到效果。
口令按下去，一切自动发生：插件或插件包解锁、安装、可用，之后更新免费。
整个过程顺得就像在输验证码——因为本来就是照着它做的。

输码只是解锁安装：买家在创作者那里获得口令，平台不涉及任何付款。

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

推广期平台零抽成。平台收的只是生成口令的积分成本（覆盖口令生成与核销的基础设施），
不参与你的定价，也不碰你的收款。

## 安装

需要 dsh web 0.1.0-rc.6 或更新版本。

从 npm（推荐，升级最省心）：

```sh
dsh plugin --profile web add dshhub-market
```

或从 DSHHub.co 指定版本（版本化链接内容永不改变，锁文件指纹稳定）：

```sh
dsh plugin --profile web add https://www.dshhub.co/dshhub-market-0.8.51.tgz
```

或从 GitHub：

```sh
dsh plugin --profile web add github:dshhub-co/dshhub-market
```

重启 `dsh web`，打开 **设置 → 插件市场**。

> 提示：若用网站版本化链接安装，每次新版本发布后需在 profile 目录跑一次
> `pnpm install --update-checksums`（链接指向最新包，锁文件指纹需刷新）；
> GitHub 直装开箱即用，无需放行构建脚本。
>
> 宿主太旧时市场会自我禁用并在浏览器控制台说明原因——如果设置里始终没有
> 「插件市场」这一项，通常就是这个原因。

## 底层能力

作为市场应用，它还自带这些实在的能力：

- **口令解锁安装**——输码即装，来源经 DSHHub.co registry 白名单校验
- **主题皮肤**——即装即换，无需重启
- **更新 / 卸载**——两步确认防误触
- **热禁用 / 启用**——约 1 秒生效，重启不丢
- **备份与恢复**——WebDAV 每日自动备份，或私有 Gist 跨机器同步
- **诊断**——加载顺序与冲突一页看全
- **加载顺序管理**——拖拽调整，写入前先校验
- **AI 修复提示**——一键复制诊断驱动的修复建议
- **脱敏日志导出**——反馈 bug 自带版本信息，隐私打码

## 安全

- 只允许安装 DSHHub.co registry 内的来源，其它一律拒绝
- 私有仓库的代码不会进入公开目录——只在买家输码安装时经平台中转
- 构建脚本默认禁止执行，放行与否由你决定
- 安装接口只接受同源请求
- 网站端本地桥接只接受环回地址与 dshhub.co 来源
- 备份导出前明确警告；日志全程脱敏

## Fork 说明

本项目 fork 自 [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)
（MIT 许可，版权保留），市场引擎相同。差异：品牌改为 `dshhub-market`，
目录与自更新通道指向 [DSHHub.co](https://www.dshhub.co)。
完整改动清单与重同步流程见 [UPSTREAM.md](UPSTREAM.md)。

## 反馈

Bug 提 [issue](https://github.com/dshhub-co/dshhub-market/issues)，附上「导出日志」
能让排查快十倍。功能建议也欢迎，动手做大 PR 前先说一声，免得两个人重复造。

注意：这个仓库是市场应用本身，不是插件目录——插件列表由 dshhub.co 提供，
请在那里上架，不要往本仓库提插件条目。

## 数据源

实时来自 [www.dshhub.co/api/registry/plugins.json](https://www.dshhub.co/api/registry/plugins.json)，
内置快照做离线兜底。

## 许可

MIT · fork of [dsh-market](https://github.com/dsh-market/dsh-market) · [dshhub.co](https://www.dshhub.co)
