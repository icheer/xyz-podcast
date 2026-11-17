# CHECKLIST.md — XYZ Podcast 实施清单与进度追踪

> **使用规则**：
> 1. 状态标记：`[ ]` 待办 · `[/]` 进行中 · `[x]` 已完成（必须附带验证结果） · `[!]` 阻塞
> 2. **实时更新**：认领任务时改为 `[/]`，完成验证后改为 `[x]` 并更新底部「交接日志」与 `AGENTS.md` 第 9 节，然后再提交 git commit。
> 3. **禁止跳步**：未运行对应验证（单测 / `wrangler dev` 实测）不得标记 `[x]`。

---

## Phase 0：调研、架构设计与交接体系（已完成）

- [x] **P0-01** 调研参考架构 `icheer/aigc-gallery`（Workers + 零构建 `public/` + Wrangler 配置方式）
  - *结果*：已核实单 Worker 入口 + 静态 HTML + CDN 图标库模式；结合本项目多视图需求采用 Workers Static Assets (`[assets]`) 零构建多文件拆分方案。
- [x] **P0-02** 实测 `xyzrank.com` 4 个 API（`episodes` / `podcasts` / `new-episodes` / `new-podcasts`）
  - *结果*：已确认均限制 `limit <= 100`、全量约 9,132 条（~93 页），提取了完整字段、中位数结构及小宇宙 `eid`/`pid` 解析规则（见 `AGENTS.md` §3.1）。
- [x] **P0-03** 实测 `xiaoyuzhoufm.com` 播客页与单集页数据提取及音频 CDN 特性
  - *结果*：已确认 `__NEXT_DATA__` 可免登录提取频道最新 15 集、单集 `enclosure.url`、`shownotes` 与约 20 条热评；确认 `media.xyzcdn.net` 支持 Range 但无 CORS 头，需 Worker 提供下载代理（见 `AGENTS.md` §3.2）。
- [x] **P0-04** 与用户确认核心方案并编写 `AGENTS.md`、`CHECKLIST.md`
  - *结果*：已确定 D1 + Free Plan 分批接力 Cron、全局常驻播放器 + `localStorage`、内页路由 + 移动卡片流/PC 自适应、浅色高对比风与流式下载代理。

---

## Phase 1：工程脚手架与 D1 数据库基础

- [x] **P1-01** 初始化 `package.json`、`wrangler.toml`、`.gitignore`、`.dev.vars.example`
  - *验收标准*：`npm install` 成功安装 `wrangler@^4`；`wrangler.toml` 包含 `DB` (D1 binding)、`ASSETS` (`./public`, SPA fallback, `run_worker_first = ["/api/*"]`) 及 `[triggers] crons = ["*/2 0,12 * * *"]`；`.gitignore` 排除 `node_modules/`、`.wrangler/`、`.dev.vars`、`.env`。
  - *验证命令*：`npx wrangler --version` -> `wrangler 4.163.0`
- [x] **P1-02** 编写 D1 数据库初始化迁移 `migrations/0001_init.sql`
  - *验收标准*：创建 `episodes_rank`、`podcasts_rank`、`board_meta`、`sync_runs`、`app_state` 5 张表及对应查询/唯一索引（参见 `AGENTS.md` §4.3）。
  - *验证命令*：`npx wrangler d1 migrations apply xyz-podcast-db --local` -> `0001_init.sql ✅` (`11 commands executed successfully`)
- [x] **P1-03** 搭建 Worker 主入口 `src/index.js` 与基础工具 `src/utils/http.js`
  - *验收标准*：实现请求路由分发（`/api/health`、占位 API 404 JSON、非 `/api/*` 交由 `env.ASSETS.fetch(request)`）、统一异常捕获 JSON 返回与 `scheduled()` 骨架。
  - *验证命令*：`wrangler dev` 实测 `/api/health` 返回 `200 {"ok":true,"db":"ok",...}`、`/api/unknown` 返回 `404` JSON、`/` 返回静态页。
- [x] **P1-04** 编写 D1 数据访问辅助模块 `src/db/schema.js`
  - *验收标准*：封装读取 `active_sync_version`（含冷启动回退逻辑）、查询最近有效版本及批量 `env.DB.batch()` 写入工具。
  - *验证命令*：`npm test` (`test/schema.test.js`) 4/4 通过。

---

## Phase 2：xyzrank 分批接力同步 & 榜单 API

- [ ] **P2-01** 实现 `xyzrank` 字段解析与校验工具（纯函数）及单元测试 `test/sync.test.js`
  - *验收标准*：正确从 `link` 提取 `eid`、从 `links` 提取小宇宙 `pid`、计算单集 `interactiveRate`、防御缺省字段。
  - *验证命令*：`npm test` 全部通过。
- [ ] **P2-02** 实现兼容 Free Plan 的分批接力状态机 `src/db/sync.js`
  - *验收标准*：
    - 每次调用控制外部 `fetch()` `<= 30` 次（远低于 Free Plan 50 上限）。
    - 按 `episodes -> new-episodes -> new-podcasts -> podcasts` 顺序分批拉取（`limit=100`）并批量 `UPSERT` 到 D1。
    - 维护 `sync_runs` 游标与防重入锁 `locked_until`；同 slot 已 `completed` 时直接快速返回（0 次外部请求）。
    - 整轮完成后原子切换 `app_state.active_sync_version` 并清理过期旧版本（保留最近 1 个历史版本）。
  - *验证命令*：构造 mock fetch 跑通 `test/sync.test.js` 状态机多轮接力测试。
- [ ] **P2-03** 接入 `scheduled()` Cron 与受保护的管理端手动同步接口 `src/handlers/admin.js`
  - *验收标准*：实现 `POST /api/admin/sync`（校验 `X-Admin-Key === env.ADMIN_KEY`）与 `GET /api/admin/sync/status`；`scheduled()` 接入状态机并在 `ctx.waitUntil()` 执行。
  - *验证命令*：使用 `npx wrangler dev --test-scheduled` 调用 `/__scheduled` 与 `POST /api/admin/sync` 多批跑完 9,100+ 条真实入库，验证 D1 表内 4 榜单条目数与 `xyzrank.com` 一致。
- [ ] **P2-04** 实现榜单元信息与查询接口 `src/handlers/boards.js`
  - *验收标准*：
    - `GET /api/boards/meta` 返回当前 `syncVersion`、各榜单总数/同步时间及可选分类列表（`primary_genre` 去重）。
    - `GET /api/boards/:board` 支持 `offset`、`limit` (`<= 100`)、`q`（关键词匹配标题/播客名/主播）、`genre`、`sort`（严格白名单映射 SQL 列）、`dir` (`asc|desc`)，返回 `{ board, items, total, offset, limit, medianValues, syncVersion, updatedAt }`。
  - *验证命令*：`curl` 实测 4 个榜单的分页、关键词搜索、分类过滤与多字段排序返回正确。

---

## Phase 3：小宇宙实时代理 & 流式音频下载

- [ ] **P3-01** 实现 `__NEXT_DATA__` 提取与数据清洗纯函数 `src/utils/parser.js` 及单测 `test/parser.test.js`
  - *验收标准*：
    - 能从 HTML 中安全提取 `<script id="__NEXT_DATA__">` 并解析播客频道结构与单集+热评结构。
    - 正确处理图片缺失继承、时长统一（秒）、付费标志 `payType` 透传、边界情况（如 404/无 `__NEXT_DATA__`）报错。
  - *验证命令*：`npm test` 通过（包含真实结构样本与异常页面测试）。
- [ ] **P3-02** 实现 `GET /api/xiaoyuzhou/podcast/:pid` (`src/handlers/xiaoyuzhou.js`)
  - *验收标准*：校验 `pid` 格式；携带浏览器 UA + `Referer: https://www.xiaoyuzhoufm.com/` 实时请求小宇宙并清洗返回播客元信息 + 最新 15 集列表 + `limited: true`。
  - *验证命令*：`curl http://localhost:8787/api/xiaoyuzhou/podcast/625635587bfca4e73e990703` 返回 200 及完整 15 集数据（含每集 `enclosureUrl`）。
- [ ] **P3-03** 实现 `GET /api/xiaoyuzhou/episode/:eid` (`src/handlers/xiaoyuzhou.js`)
  - *验收标准*：校验 `eid` 格式；实时请求并返回单集详情（含 `enclosureUrl`、所属播客 `podcast.pid`、`shownotes`、`payType`）及热评列表（含置顶、二级回复）+ `limited: true`。
  - *验证命令*：`curl http://localhost:8787/api/xiaoyuzhou/episode/6aec7f8c5b7c4709bfe1a757` 返回 200 及完整单集与评论 JSON。
- [ ] **P3-04** 实现 `GET /api/audio/download` (`src/handlers/download.js`)
  - *验收标准*：严格校验 `url` 为 `https://` 且 hostname 在白名单（`media.xyzcdn.net` / `*.xyzcdn.net` / `*.xiaoyuzhoufm.com`），非白名单返回 400/403；流式转发 `res.body`，返回安全清理后的 `Content-Disposition: attachment; filename*=UTF-8''...`。
  - *验证命令*：`curl -I` 实测白名单音频返回 `200` + `Content-Disposition: attachment`，非白名单 URL（如 `http://127.0.0.1` 或 `https://evil.com`）被拒绝并返回 400/403。

---

## Phase 4：前端基础框架、响应式样式 & 首页 4 榜单

- [ ] **P4-01** 创建 `public/index.html` 与样式系统 `public/css/app.css`
  - *验收标准*：引入 `vue@3/dist/vue.global.prod.js`、`vue-router@4/dist/vue-router.global.prod.js`、`dompurify`、`sortablejs`、`lucide`（CDN/unpkg）；添加 `<meta name="referrer" content="no-referrer">` 与移动端 `viewport-fit=cover`；完成浅色高对比 CSS 变量体系及底部迷你播放器安全留白。
- [ ] **P4-02** 编写前端公共模块 `public/js/api.js`、`public/js/utils.js`、`public/js/storage.js`
  - *验收标准*：封装 API 请求、时长格式化（`mm:ss` / `hh:mm:ss`，注意区分榜单分钟 vs 小宇宙秒）、数字缩写（如 `42.9万`）、Shownotes 时间戳 HTML 高亮转换工具，以及 `localStorage` 读写接口。
- [ ] **P4-03** 实现根应用 `public/js/app.js`（Vue 3 Options API + VueRouter）
  - *验收标准*：配置 `/`, `/hot-podcasts`, `/hot-episodes-new`, `/new-podcasts`, `/podcast/:pid`, `/episode/:eid` 路由；顶部吸顶 Header（Logo、搜索防抖 400ms、4 榜单 Tab 切换、同步时间提示）。
- [ ] **P4-04** 实现首页榜单组件 `public/js/components/RankBoard.js`
  - *验收标准*：
    - 4 榜单支持排序下拉/列头切换、分类筛选、触底 `IntersectionObserver` 分页加载更多。
    - 手机端 (`< 768px`) 为高可读卡片流（单集榜卡片支持直接点击进入 `/episode/:eid`，同时待单集音频懒解析或播客页直播支持快捷播放/加队列；播客榜进入 `/podcast/:pid`）。
    - PC 端 (`>= 768px`) 自适应宽卡片或完整多列排序表格（含中位数提示）。
  - *验证命令*：在本地 `wrangler dev` 下实测手机宽度 (390px) 与桌面宽度 (1280px) 4 个榜单加载、搜索、排序、分类过滤正常无横向溢出。

---

## Phase 5：播客频道页 & 单集播放详情页

- [ ] **P5-01** 实现播客频道页 `public/js/components/PodcastView.js` (`/podcast/:pid`)
  - *验收标准*：展示频道封面、名称、作者、订阅数/总集数、简介（长文本支持展开/收起）、"去小宇宙官网"外链、明确提示「网页端仅展示最新 15 集」；每集支持「▶ 播放」「+ 加入播放列表」「看详情」，顶部提供「全部加入播放列表」快捷按钮。
- [ ] **P5-02** 实现单集播放页 `public/js/components/EpisodeView.js` (`/episode/:eid`)
  - *验收标准*：展示封面、标题、可点跳转 `/podcast/:pid` 的所属播客、发布时间、时长、数据指标、付费/试听提示（若非免费）、"去小宇宙官网"外链；操作栏含「▶ 播放 / ⏸ 暂停」「+ 加入播放列表」「⬇ 下载音频」（直连 `/api/audio/download`）。
- [ ] **P5-03** 实现单集 Shownotes 净化与时间戳跳转 + 热评区渲染
  - *验收标准*：Shownotes 经 `DOMPurify.sanitize()` 净化后渲染，文中时间戳（如 `05:32`、`1:02:15`）自动可点击并触发播放定位跳转；热评区展示置顶标识、头像、昵称、IP 属地、点赞数、Badge 及二级回复，并展示「网页端仅显示部分热评」提示。

---

## Phase 6：全局播放器、播放列表与断点续播

- [ ] **P6-01** 实现全局音频引擎与 `localStorage` 持久化（`app.js` + `storage.js`）
  - *验收标准*：单一 `<audio>` 实例跨路由切换不断播；每 3~5 秒、暂停、`seeked`、`pagehide` 时保存 `{ currentTime, duration, finished, updatedAt }`（最多保留 200 条按时间淘汰）；重新加载同一 `eid` 时自动恢复进度（剩余 > 5s）。
- [ ] **P6-02** 实现底部迷你播放器与展开全屏播控页 `public/js/components/PlayerBar.js`
  - *验收标准*：
    - 迷你播放器：封面、标题、播放/暂停、-15s/+30s（或下一曲）、进度条、展开按钮、列表按钮。
    - 全屏播控页：大封面、可拖动进度条（预览+seek）、**后退 15 秒 (`-15s`)**、**前进 30 秒 (`+30s`)**、**倍速 (`0.75x ~ 2.0x`)**、**三态循环 (`sequential` / `repeat-one` / `repeat-all`)**、下载音频入口。
    - 集成 `navigator.mediaSession` API 支持系统锁屏/媒体键控制。
- [ ] **P6-03** 实现播放列表抽屉与条目调序 `public/js/components/PlaylistDrawer.js`
  - *验收标准*：展示当前播放队列及每集已保存进度百分比；集成 `SortableJS` 实现移动端/PC 端拖拽排序，同时提供上移/下移/置顶/移除/清空按钮；在首页单集榜单点击「▶ 播放 / + 队列」时自动先调用 `/api/xiaoyuzhou/episode/:eid` 补全 `enclosureUrl` 后立即播放或入队。
- [ ] **P6-04** 播放状态机边界与 `storage.js` 单元测试
  - *验收标准*：测试循环模式切换（顺序末集停、列表循环回首集、单曲循环重播）、进度淘汰上限（200 条）及已播完重新从头播放逻辑。

---

## Phase 7：全链路测试、边界打磨与部署

- [ ] **P7-01** 全链路回归验证（手机端 390x844 与桌面端 1280x800）
  - *验收标准*：验证 4 个榜单切换、搜索排序、进播客页播放、进单集页 Shownotes 时间戳跳转、切回首页不断播、队列拖拽排序、刷新浏览器后进度与队列恢复、点击下载音频文件命名正确。
- [ ] **P7-02** 异常场景与限流兜底审查
  - *验收标准*：小宇宙请求失败/404/超时（设合理 timeout）、付费单集无可用直链、空搜索结果、网络离线提示均有友好 UI 反馈与重试按钮，无未捕获控制台报错。
- [ ] **P7-03** 文档与代码最终一致性审查
  - *验收标准*：核对 `AGENTS.md`、`CHECKLIST.md`、`CLAUDE.md` 与实际文件树、路由、命令完全一致，无遗留占位符。
- [ ] **P7-04** 部署上线指南 / 远程验证（若环境提供 Cloudflare 凭证）
  - *验收标准*：提供或执行 `wrangler d1 create`、`wrangler d1 migrations apply --remote`、`wrangler secret put ADMIN_KEY`、`wrangler deploy` 及首次冷启动 `POST /api/admin/sync` 验证。

---

## 交接日志（Handover Log）

| 日期 | 阶段/任务 | 完成/变更摘要 | 验证状态 | 遗留/下一步 |
|---|---|---|---|---|
| 2026-11-17 | Phase 0 (`P0-01`~`P0-04`) | 完成 `aigc-gallery`、`xyzrank.com`（4 API）、`xiaoyuzhoufm.com`（SSR `__NEXT_DATA__` 与音频 CDN 头）实测调研；确认 4 项架构决策；创建 `AGENTS.md` 与 `CHECKLIST.md` | 已通过 curl / python 脚本实测上游真实返回 | 进入 Phase 1 |
| 2026-11-17 | Phase 1 (`P1-01`~`P1-04`) | 初始化 `package.json`、`wrangler.toml`、`.gitignore`、`.dev.vars.example`、`migrations/0001_init.sql`、`src/index.js`、`src/utils/http.js`、`src/db/schema.js`、`public/index.html` 占位与 `test/schema.test.js` | `wrangler d1 migrations apply --local` 成功；`wrangler dev` `/api/health` 返回 200；`npm test` 4/4 通过 | 下一步执行 Phase 2 (`P2-01`~`P2-04`) |
