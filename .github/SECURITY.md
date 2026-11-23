# 安全策略 / Security Policy

本项目（外刊阅读器 · Foreign Article Reader）是一个**纯前端、静态托管**的双语阅读与考研英语练习工具：没有自建后端、数据库或账号体系，学习数据仅保存在使用者浏览器的 `localStorage` 中，阅读器核心默认不向第三方服务器发起网络请求。

## 支持版本

| 版本 | 是否接收安全修复 |
| --- | --- |
| `main` 分支最新代码 / GitHub Pages 最新部署 | ✅ |
| 更早的提交、历史 tag 或自行下载的旧副本 | ❌（请更新到最新版） |

当前为业余维护的开源项目，不提供商业 SLA 与漏洞赏金；会在能力范围内尽快处理。

## 如何报告安全漏洞

**请不要在公开 Issue、Pull Request 或讨论区中直接贴出可利用细节、Token、个人数据或受版权保护的文章内容。**

推荐方式（私密）：

1. 打开仓库页面的 **Security → Report a vulnerability**（GitHub Private Vulnerability Reporting）。
2. 若未看到该入口（可能尚未开启），可先开一个标题以 `[SECURITY]` 开头的**简短** Issue，仅说明“存在安全问题，请求建立私密沟通渠道”，**不要**包含复现利用代码或敏感数据；维护者看到后会通过 GitHub 私密渠道跟进。
3. 也可通过提交记录中的 GitHub noreply 身份在仓库内联系维护者。

报告时建议包含：影响位置（文件/功能）、复现步骤、影响评估、浏览器与版本、可选的修复建议。

### 建议受理的范围

- 阅读器渲染层的 XSS / HTML 注入（如标注、笔记、导入数据未正确转义）
- 笔记、备份导入、本地存储处理导致的数据损坏或丢失
- 构建脚本（`scripts/`）或发布产物中的密钥泄露、危险命令注入
- 依赖与 CI 配置中的已知高危问题

### 不在受理范围

- 针对静态站点的通用扫描器结果、缺少安全响应头的泛化报告（可附具体可利用证据再报）
- 浏览器自身漏洞、操作系统/物理接触他人设备
- 拒绝服务、社工、针对 GitHub 平台本身的问题（请报给 GitHub）

## 已有的安全设计

- **无服务端攻击面**：静态文件 + 浏览器本地存储，不存在可被远程攻破的自有服务器。
- **无数据外传通道**：阅读器核心不使用统计/埋点 SDK，默认不发起第三方 `fetch` / `XMLHttpRequest` / WebSocket / `sendBeacon`。
- **渲染转义**：用户产生的标注、笔记、上下文等动态内容在写入 `innerHTML` 前统一经 HTML 转义；富文本粘贴按纯文本净化。
- **无密钥入库**：仓库不包含任何 Token、私钥或账号口令；受版权保护的文章、真题库与个人数据通过 `.gitignore` 排除。
- **提交邮箱隐私**：维护者提交使用 GitHub 提供的 `users.noreply.github.com` 邮箱，不公开真实邮箱。

## 使用者安全建议

- 为你的 GitHub 账号开启**两步验证（2FA）**；使用 Personal Access Token 时遵循最小权限原则并定期轮换，不要在公共电脑保留登录态。
- 学习数据只存在当前浏览器：清理浏览器站点数据前，请先用应用内的“导出 / 备份”功能保存 JSON。
- 仅从本仓库的 GitHub Pages 或官方 Release 获取成品，不要运行来源不明的二次打包版本。
- 导入他人分享的备份 JSON 前，先确认来源可信；导入数据会写入本地存储。

## 披露流程

1. 维护者通过私密渠道确认问题与影响范围；
2. 在 `main` 分支修复并（如需要）重新部署 GitHub Pages；
3. 修复发布后再公开问题说明与致谢（报告者可选择匿名）。

---

## Reporting a Vulnerability (English summary)

This is a client-side-only static web app with no backend and no accounts; user data stays in the browser's `localStorage`. Please report suspected vulnerabilities privately via **Security → Report a vulnerability**. Do not open a public issue with exploit details, tokens, personal data, or copyrighted article content. Only the latest `main` / Pages deployment is supported. This is a best-effort, non-bug-bounty project.
