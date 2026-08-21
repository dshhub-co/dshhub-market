<p align="center">
  <img src="assets/logo.svg" width="96" alt="dshhub-market logo">
</p>

# dshhub-market

[English](README.md) | 中文

[![npm](https://img.shields.io/npm/v/dshhub-market)](https://www.npmjs.com/package/dshhub-market)
[![stars](https://img.shields.io/github/stars/dshhub-co/dshhub-market?style=flat)](https://github.com/dshhub-co/dshhub-market)
[![CI](https://github.com/dshhub-co/dshhub-market/actions/workflows/ci.yml/badge.svg)](https://github.com/dshhub-co/dshhub-market/actions/workflows/ci.yml)

> 好货都有暗号，输对码上装。

dshhub-market 是装在 DSH（DeepSeek Harness）里的口令插件市场。买家输个码，
插件就装好；创作者在私域发码，把好东西送到对的人手上；免费插件也经它牵线搭桥。
由 [DSHHub.co](https://www.dshhub.co) 运营。

## 买家看到什么

想象这个画面：你在 DSH 里打开插件市场，首页干干净净，只有一个口令输入框。

没有目录，没有推荐，没有注册。买家永远不需要登录，唯一的入口就是那 6 位口令——
比如 3K7M9P。

试试演示口令 **080808**：输进去，一个皮肤插件当场解锁装好，立刻看到效果。
就当是第一次见面的握手。

口令按下去，一切自动发生：插件或插件包解锁、安装、可用。之后更新免费，
整个过程顺得就像在输验证码——因为本来就是照着它做的。输码只是拿插件，
不涉及任何付款。

解锁之后，每张卡片只讲两件事：谁做的，和它有什么用。谁提供、博主寄语、
能干什么、安装按钮、使用指南、联系作者——一切都围绕「人 + 用处」。

已解锁的都在「我解锁的插件」里，随时回来装、换、卸。解锁过的插件就认准你的
DSH 了：重装、更新都不再扣码。

## 创作者得到什么

创作者从 [dshhub.co](https://www.dshhub.co) 进入，GitHub 授权登录，两条货源任选：

- 从官方精选目录挑插件，上架到自己的橱柜
- 导入自有 GitHub 仓库（公开或私有）

随后生成口令，把码发到自己的私域——视频、直播、文章——粉丝输码即装。
平台提供核销统计与分销批次统计：码发到哪、装了几个，一目了然。
码核销即作废；还没被用的码可以转赠，正好交给分销伙伴。

核心从来不是源码，是教学与答疑，是「人」本身的价值。插件免费，服务有价——
用口令买单的人，买的是你这个人。推广期平台零抽成，之后的收费方式会提前公布。

## 安装

需要 dsh web 0.1.0-rc.6 或更新版本。

从 npm：

```sh
dsh plugin --profile web add dshhub-market
```

或从 DSHHub.co 指定版本（版本化链接内容永不改变，锁文件指纹稳定）：

```sh
dsh plugin --profile web add https://www.dshhub.co/dshhub-market-0.8.2.tgz
```

或从 GitHub：

```sh
dsh plugin --profile web add github:dshhub-co/dshhub-market
```

重启 `dsh web`，打开 **设置 → 插件市场**。

推荐用 npm 名字安装（版本升级最省心）。若用网站链接安装，每次发布新版本后
需在 profile 目录跑一次 `pnpm install --update-checksums`（链接指向最新包，
锁文件指纹需刷新）；GitHub 直装开箱即用，无需放行构建脚本。

宿主太旧时市场会自我禁用，并在浏览器控制台说明原因——如果设置里始终没有
「插件市场」这一项，通常就是这个原因。桌面端可能内置了比 npm 装到的更旧的 dsh。

## 底层能力

作为市场应用，它还自带这些实在的能力：

- **一键安装**——确认来源，实时进度，多数插件刷新即可用
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
- 私有仓库的代码不会进入公开目录——只在粉丝输码安装时经平台中转
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
