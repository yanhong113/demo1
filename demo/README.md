# 2027 尾牙积分平台

此目录包含 H5 页面、云端 Worker 源码、数据库迁移、测试和设计开发流程文档。

GitHub Pages 入口为 `https://yanhong113.github.io/demo1/demo/`。页面发布成功后可通过此地址访问。

H5 连接的业务 API 为 `https://qingyu-login-portal.xphyym.chatgpt.site`，员工、积分、竞标与得标结果保存于该站点绑定的 Cloudflare D1 数据库。

## 页面与源文件

根目录的 index.html、style.css、app.js、qr.js 和 config.js 是 GitHub Pages 使用的 H5 文件，由 web 目录和构建脚本生成。

- web 保存前端源文件。
- server 保存业务规则与 Worker API 源码。
- drizzle 保存数据库迁移。
- scripts 保存构建和本地预览脚本。
- tests 保存业务、二维码与跨域会话测试。
- 设计开发流程.md 记录整体设计与开发流程。

GitHub Pages 通过精确来源校验和短期 Bearer 会话调用云端 API。浏览器在 sessionStorage 保存该标签页的令牌，退出登录时清除令牌。原云端入口继续使用 HttpOnly Cookie 会话。

## 本地开发

使用 Node.js 24，在本目录运行以下命令。

```powershell
npm run build
npm test
node scripts/preview.mjs
```

本地预览服务使用本机 SQLite 数据库，地址为 `http://127.0.0.1:4173/`。

生成 GitHub Pages 文件时运行以下命令。

```powershell
node scripts/build-pages.mjs .
```

## 发布流程

仓库启用 GitHub Pages 并选择 GitHub Actions 作为发布来源后，向 main 分支推送 demo 目录的变更将运行 `.github/workflows/pages.yml`，完成测试、生成页面和发布。

修改 web 源文件后，可以重新生成本目录的 H5 文件再提交。Actions 也会从 web 源文件生成线上页面。

服务端修改需要另外构建并部署至现有云端站点。Pages 工作流负责发布 H5 页面，业务 API 的发布由 Sites 完成。

本目录的托管配置声明 DB 数据库绑定。实际云端站点身份由部署环境配置。
