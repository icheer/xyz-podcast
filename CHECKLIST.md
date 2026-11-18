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

- [x] **P2-01** 实现 `xyzrank` 字段解析与校验工具（纯函数）及单元测试 `test/sync.test.js`
  - *验收标准*：正确从 `link` 提取 `eid`、从 `links` 提取小宇宙 `pid`、计算单集 `interactiveRate`、防御缺省字段。
  - *验证命令*：`npm test` 全部通过（10/10）。
- [x] **P2-02** 实现兼容 Free Plan 的分批接力状态机 `src/db/sync.js`
  - *验收标准*：
    - 每次调用控制外部 `fetch()` `<= 30` 次（默认 `DEFAULT_MAX_PAGES_PER_BATCH = 15`，远低于 Free Plan 50 上限）。
    - 按 `episodes -> new-episodes -> new-podcasts -> podcasts` 顺序分批拉取（`limit=100`）并批量 `UPSERT` 到 D1。
    - 维护 `sync_runs` 游标与防重入锁 `locked_until`；同 slot 已 `completed` 时直接快速返回（0 次外部请求）。
    - 整轮完成后原子切换 `app_state.active_sync_version` 并清理过期旧版本（保留最近 1 个历史版本）。
  - *验证命令*：`test/sync.test.js` 多轮接力、版本切换、旧版本清理、已完成跳过测试全部通过。
- [x] **P2-03** 接入 `scheduled()` Cron 与受保护的管理端手动同步接口 `src/handlers/admin.js`
  - *验收标准*：实现 `POST /api/admin/sync`（校验 `X-Admin-Key === env.ADMIN_KEY`）与 `GET /api/admin/sync/status`；`scheduled()` 接入状态机并在 `ctx.waitUntil()` 执行；`wrangler.toml` `run_worker_first` 包含 `/__scheduled`。
  - *验证命令*：`wrangler dev --test-scheduled` 实测未鉴权返回 `401`、`/__scheduled` 返回 `200 Ran scheduled event`、4 批次同步真实 `xyzrank.com` 共 `9,132` 条（791+19+131+8191）完整入库。
- [x] **P2-04** 实现榜单元信息与查询接口 `src/handlers/boards.js`
  - *验收标准*：
    - `GET /api/boards/meta` 返回当前 `syncVersion`、各榜单总数/同步时间及可选分类列表（`primary_genre` 去重）。
    - `GET /api/boards/:board` 支持 `offset`、`limit` (`<= 100`)、`q`（关键词匹配标题/播客名/主播）、`genre`、`sort`（严格白名单映射 SQL 列）、`dir` (`asc|desc`)，返回 `{ board, items, total, offset, limit, medianValues, syncVersion, updatedAt }`。
  - *验证命令*：`wrangler dev` 实测 `meta` 与 4 榜单分页、关键词搜索（`q=AI` -> 43条）、分类过滤（`犯罪纪实` -> 31条）与排序均正确。

---

## Phase 3：小宇宙实时代理 & 流式音频下载

- [x] **P3-01** 实现 `__NEXT_DATA__` 提取与数据清洗纯函数（前后端共享 `public/js/xyzParser.js`，`src/utils/parser.js` 重导出）及单测 `test/parser.test.js`
  - *验收标准*：
    - 能从 HTML 中安全提取 `<script id="__NEXT_DATA__">` 并解析播客频道结构与单集+热评结构。
    - 正确处理图片缺失继承、时长统一（秒）、付费标志 `payType` 透传、边界情况（如 404/无 `__NEXT_DATA__`）报错。
  - *验证命令*：`npm test` 全部通过（15/15）。
- [x] **P3-02** 打通小宇宙播客频道实时抓取（浏览器端 CORS 直连为主 + Worker `/api/xiaoyuzhou/podcast/:pid` 可选 `XYZ_RELAY_URL` 兜底）
  - *验收标准*：校验 `pid` 格式；浏览器端直连 `https://www.xiaoyuzhoufm.com/podcast/:pid` 绕过 Worker `CF-Worker` 头限制并由 `xyzParser.js` 清洗返回频道元信息 + 最新 15 集列表 + `limited: true`；后端保留同构兜底接口。
  - *验证命令*：真实浏览器环境（Playwright + Obscura 连接本地 `http://127.0.0.1:8787/`）实测浏览器 CORS `fetch` 返回 `200`、标题 `岩中花述`、完整 `15` 集。
- [x] **P3-03** 打通小宇宙单集详情实时抓取（浏览器端 CORS 直连为主 + Worker `/api/xiaoyuzhou/episode/:eid` 可选 `XYZ_RELAY_URL` 兜底）
  - *验收标准*：校验 `eid` 格式；浏览器端直连实时解析单集详情（含 `enclosureUrl`、所属播客 `podcast.pid`、`shownotes`、`payType`）及热评列表（含置顶、二级回复）+ `limited: true`。
  - *验证命令*：真实浏览器环境实测 CORS `fetch` 返回 `200`、含 `enclosure.url`（`media.xyzcdn.net`）及 `21` 条热评。
- [x] **P3-04** 实现 `GET /api/audio/download` (`src/handlers/download.js`)
  - *验收标准*：严格校验 `url` 为 `https://` 且 hostname 在白名单（`media.xyzcdn.net` / `*.xyzcdn.net` / `*.xiaoyuzhoufm.com`），非白名单返回 400/403；流式转发 `res.body`，返回安全清理后的 `Content-Disposition: attachment; filename*=UTF-8''...`。
  - *验证命令*：`wrangler dev` 实测 `HEAD /api/audio/download` 转发 `media.xyzcdn.net` 返回 `200`（`audio/mp4`, `75582408` bytes, `Accept-Ranges: bytes`, 完整 UTF-8 `Content-Disposition`）；`evil.com` 返回 `403`，`http://127.0.0.1` 返回 `400`；`test/parser.test.js` 安全校验单测全过。

---

## Phase 4：前端基础框架、响应式样式 & 首页 4 榜单

- [x] **P4-01** 创建 `public/index.html` 与样式系统 `public/css/app.css`
  - *验收标准*：引入 `vue@3/dist/vue.global.prod.js`、`vue-router@4/dist/vue-router.global.prod.js`、`dompurify`、`sortablejs`、`lucide`（CDN/unpkg）；添加 `<meta name="referrer" content="no-referrer">` 与移动端 `viewport-fit=cover`；完成浅色高对比 CSS 变量体系及底部迷你播放器安全留白。
  - *验证结果*：Playwright 实测 5 个 unpkg 资源全返回 `200`，浅/深色主题变量与底部播放器留白正常。
- [x] **P4-02** 编写前端公共模块 `public/js/api.js`、`public/js/utils.js`、`public/js/storage.js`
  - *验收标准*：封装 API 请求、时长格式化（`mm:ss` / `hh:mm:ss`，注意区分榜单分钟 vs 小宇宙秒）、数字缩写（如 `42.9万`）、Shownotes 时间戳 HTML 高亮转换工具，以及 `localStorage` 读写接口。
  - *验证结果*：`test/frontend.test.js` 全数通过（包含小宇宙原生 `<a data-timestamp="...">` 与纯文本时间戳转换）。
- [x] **P4-03** 实现根应用 `public/js/app.js`（Vue 3 Options API + VueRouter）
  - *验收标准*：配置 `/`, `/hot-podcasts`, `/hot-episodes-new`, `/new-podcasts`, `/podcast/:pid`, `/episode/:eid` 路由；顶部吸顶 Header（Logo、搜索防抖 400ms、4 榜单 Tab 切换、同步时间提示）。
  - *验证结果*：真实浏览器实测全部路由切换、搜索防抖与历史回退正常，0 控制台报错。
- [x] **P4-04** 实现首页榜单组件 `public/js/components/RankBoard.js`
  - *验收标准*：
    - 4 榜单支持排序下拉/列头切换、分类筛选、触底 `IntersectionObserver` 分页加载更多。
    - 手机端 (`< 768px`) 为高可读卡片流（单集榜支持快捷播放/加队列；播客榜进入 `/podcast/:pid`）。
    - PC 端 (`>= 768px`) 自适应完整多列排序表格（含中位数提示）。
  - *验证结果*：Playwright 实测 390px 移动卡片流（40条、`horizontalOverflow: False`）与 1280px 桌面表格（`tableVisible: True`、`overflow: False`）、4 榜单切换、搜索 `"AI"`（43条）与列排序全部通过。

---

## Phase 5：播客频道页 & 单集播放详情页

- [x] **P5-01** 实现播客频道页 `public/js/components/PodcastView.js` (`/podcast/:pid`)
  - *验收标准*：展示频道封面、名称、作者、订阅数/总集数、简介（长文本支持展开/收起）、"去小宇宙官网"外链、明确提示「网页端仅展示最新 15 集」；每集支持「▶ 播放」「+ 加入播放列表」「看详情」，顶部提供「全部加入播放列表」快捷按钮。
  - *验证结果*：Playwright 实测 `/podcast/620e4b8f52d497504647ce24`（霓达播客）与 `岩中花述` 均正常渲染 15 集并一键全部加入队列。
- [x] **P5-02** 实现单集播放页 `public/js/components/EpisodeView.js` (`/episode/:eid`)
  - *验收标准*：展示封面、标题、可点跳转 `/podcast/:pid` 的所属播客、发布时间、时长、数据指标、付费/试听提示（若非免费）、"去小宇宙官网"外链；操作栏含「▶ 播放 / ⏸ 暂停 / 继续播放」「+ 加入播放列表」「⬇ 下载音频」（直连 `/api/audio/download`）。
  - *验证结果*：Playwright 实测跳转所属播客、下载链接指向 `/api/audio/download`、刷新后主按钮正确显示 `继续播放 (04:42)`。
- [x] **P5-03** 实现单集 Shownotes 净化与时间戳跳转 + 热评区渲染
  - *验收标准*：Shownotes 经 `DOMPurify.sanitize()` 净化后渲染，文中时间戳（含小宇宙原生 `data-timestamp` 与纯文本 `05:32`/`1:02:15`）自动可点击并触发播放定位跳转；热评区展示置顶标识、头像、昵称、IP 属地、点赞数、Badge 及二级回复，并展示「网页端仅显示部分热评」提示。
  - *验证结果*：Playwright 实测单集 `6aec7f8c5b7c4709bfe1a757` 渲染 26 个 `.ts-jump-btn` 与 21 条评论，点击 `04:42` 后播放器立即跳转并持久化进度 `282s`。

---

## Phase 6：全局播放器、播放列表与断点续播

- [x] **P6-01** 实现全局音频引擎与 `localStorage` 持久化（`app.js` + `storage.js`）
  - *验收标准*：单一 `<audio>` 实例跨路由切换不断播；每 3 秒、暂停、`seeked`、`pagehide` 及时间戳跳播时保存 `{ currentTime, duration, finished, updatedAt }`（最多保留 200 条按时间淘汰）；重新加载同一 `eid` 时自动恢复进度（剩余 > 5s）。
  - *验证结果*：Playwright 实测跨路由不断播及刷新后恢复队列（16集）与进度 `04:42`。
- [x] **P6-02** 实现底部迷你播放器与展开全屏播控页 `public/js/components/PlayerBar.js`
  - *验收标准*：
    - 迷你播放器：封面、标题、播放/暂停、-15s/+30s、进度条、展开按钮、列表按钮。
    - 全屏播控页：大封面、可拖动进度条（预览+seek）、**后退 15 秒 (`-15s`)**、**前进 30 秒 (`+30s`)**、**倍速 (`0.75x ~ 2.0x`)**、**三态循环 (`sequential` / `repeat-one` / `repeat-all`)**、下载音频入口。
    - 集成 `navigator.mediaSession` API 支持系统锁屏/媒体键控制。
  - *验证结果*：Playwright 实测 `-15s`/`+30s`、`1.5x` 倍速与循环模式切换并刷新持久化。
- [x] **P6-03** 实现播放列表抽屉与条目调序 `public/js/components/PlaylistDrawer.js`
  - *验收标准*：展示当前播放队列及每集已保存进度百分比；集成 `SortableJS` 实现移动端/PC 端拖拽排序，同时提供上移/下移/移除/清空按钮；在首页单集榜单点击「▶ 播放 / + 队列」时自动获取 `enclosureUrl` 后立即播放或入队。
  - *验证结果*：Playwright 实测 `window.Sortable` 就绪、首页快捷入队与抽屉上下移调序正常。
- [x] **P6-04** 播放状态机边界与 `storage.js` 单元测试
  - *验收标准*：测试循环模式/偏好设置、进度淘汰上限（200 条）及已播完重新从头播放逻辑。
  - *验证结果*：`npm test` (`test/frontend.test.js`) 全部通过。

---

## Phase 7：全链路测试、边界打磨与部署

- [x] **P7-01** 全链路回归验证（手机端 390x844 与桌面端 1280x800）
  - *验收标准*：验证 4 个榜单切换、搜索排序、进播客页播放、进单集页 Shownotes 时间戳跳转、切回首页不断播、队列调序、刷新浏览器后进度与队列恢复。
  - *验证结果*：Playwright + Obscura 实测全部通过，`CONSOLE/PAGE ERRORS: []`。
- [x] **P7-02** 异常场景与限流兜底审查
  - *验收标准*：小宇宙请求失败/404/超时（12s timeout）、无效单集路由均展示友好中文提示与重试/官网跳转入口，无未捕获控制台报错。
  - *验证结果*：实测访问无效单集 `/episode/nonexistent0000000000` 正确渲染友好错误态且无报错。
- [x] **P7-03** 文档与代码最终一致性审查
  - *验收标准*：核对 `AGENTS.md`、`CHECKLIST.md`、`CLAUDE.md` 与实际文件树、路由、命令完全一致，无遗留占位符。
- [x] **P7-04** 首次线上部署与 D1 绑定
  - *验收标准*：完成 `wrangler login`、创建远程 D1 (`224bbab0-b5e7-4547-9735-9038d63b8f53`)、应用远程迁移、配置 `ADMIN_KEY` 与 `wrangler deploy`。
  - *验证结果*：已上线至 `https://xyz-podcast.icheer.workers.dev`，`/api/health` 返回 `{"ok":true,"db":"ok"}`，已开始冷启动同步。
- [x] **P7-05** PWA 沉浸式体验、列表卡片重构、返回滚动保持与 `README.md`
  - *完成内容*：
    - PWA：`public/icon.svg`、`public/icon-192.png`、`public/icon.png` (256x256)、`public/icon-512.png`、`public/site.webmanifest`、`public/sw.js`、`index.html` PWA meta 与 `app.js` 注册/主题色同步。
    - 移动端卡片与播放器重构：`RankBoard.js` 两段式卡片（主标题占满全宽、底部虚线分隔数据与 `播放`/`+` 胶囊按钮）、加载骨架屏、`PlayerBar.js` 窄屏精简按钮、自适应安全区、`PlaylistDrawer.js` `min-height: 56vh` 防塌陷与顶部拖拽指示条。
    - 返回不刷新与滚动位置恢复：`app.js` 为 `RankBoard` / `PodcastView` 接入按路由区分 `:key` 的 `<keep-alive>`，抽离公共 `scrollKeeperMixin` (`public/js/utils.js`) 保存与恢复各列表的 `savedScrollY` 并管理 `IntersectionObserver` 激活态。
    - 最终 CSS 修正：统一 `font-weight` 为 `500/700`、移除 `backdrop-filter` 避免抽屉层透出底层文字、修复搜索框占位文字垂直居中；编写项目 `README.md`。
  - *验证结果*：后续 UI 走查与用户验收通过。
- [x] **P7-06** 移除音频下载功能、固定全局 Header、榜单虚拟滚动
  - *完成内容*：
    - 移除下载功能（版权合规）：删除 `EpisodeView.js` 与 `PlayerBar.js`「下载音频」按钮、删除 `public/js/api.js` `buildAudioDownloadUrl`、移除 `src/index.js` `/api/audio/download` 路由并清理 `test/parser.test.js` 对应测试用例。
    - 固定整个 Header：将 `public/css/app.css` `html, body` 改为 `overflow-x: clip`，`.site-header` 改为 `position: fixed; top: 0; left: 0; right: 0;`，`.app-shell` 使用 `padding-top: var(--header-h, 146px)`；`public/js/app.js` 通过 `ResizeObserver` 与路由切换 `$nextTick` 实时同步 `--header-h`。
    - 榜单虚拟滚动：`public/js/utils.js` 新增 `computeVirtualWindow` 纯函数（支持前缀和与二分查找、动态行高缓存及 `test/frontend.test.js` 单测）；`RankBoard.js` 为移动端 `.rank-cards`（上下 padding 占位）与桌面端 `.rank-table`（上下 `virtual-spacer-row`）接入实测行高虚拟滚动并与 `<keep-alive>` / `onAfterScrollRestore` 协同。
    - 移动端迷你播放栏排版重构：`AppIcon.js` 新增将数字 `15` / `30` 内嵌于回环箭头中的自定义 SVG 图标（`skip-back-15` / `skip-forward-30`）并统一用于迷你栏与全屏播控页。
  - *验证结果*：后续多轮回归与用户验收通过。

---

## 前端设计审查与功能演进（2026-11-17 ~ 2026-11-18）

- [/] **REFACTOR-P3**（2026-11-18）`app.css` 级联架构单源化重构与跨组件冗余逻辑收敛（100% 保持既有视觉与交互）
  - **CSS 架构重构 (`public/css/app.css`)**：
    - 消除多轮迭代追加在尾部的 ~80 处重复选择器覆盖：合并重复的 `:root` / `[data-theme="dark"]` 变量定义，将 Header、榜单卡片/表格、详情页 Hero/Shownotes/评论、迷你与全屏播放器、双抽屉（播放队列与我的收听）各自的最终生效样式归入单一职责分节（11 个清晰章节）。
    - 将原本分散在 5 处的 `@media (min-width: 768px)` 与多处窄屏/短屏/减少动态效果媒体查询统一收拢到底部响应式章节，确保 `.library-panel` 桌面端 `100dvh` 高度与 `.ep-pod-row .podcast-link-pill` 水平基线对齐更加严谨。
  - **JS 公共逻辑去重与内存边界**：
    - `public/js/utils.js` 抽离统一进度文案纯函数 `formatProgressBadge`（并在 `test/frontend.test.js` 增加单测），替换 `RankBoard.js`、`PodcastView.js`、`PlaylistDrawer.js`、`LibraryDrawer.js` 四处重复的收听百分比/已播完计算逻辑（同时统一频道页已播完单集显示为 `已播完`）。
    - `PlaylistDrawer.js` 合并重复的 5 秒撤销定时器代码，与 `LibraryDrawer.js` 共享 `.drawer-head-title` / `.drawer-head-actions` / `.drawer-thumb` / `.accent-text` 样式类，清理模板内联样式。
    - `public/js/api.js` 为 `episodeDetailCache` / `podcastDetailCache` 增加 `MAX_DETAIL_CACHE = 60` 容量上限淘汰，防止长会话内存无界增长；`index.html` 升至 `app.css?v=30`、`app.js?v=32`，`sw.js` 升至 `v5`。
  - **当前验证状态**：代码与单测均已静态复核；待在仓库根目录运行 `npm test` 与快速回归确认后改为 `[x]` 并部署。

- [x] **FEAT-P2**（2026-11-18）实现免登录本地「我的收听」中心（关注播客 / 收听历史 / JSON 备份恢复 / OPML 导出）与 PC 桌面端全局播控快捷键
  - **P2-2「我的收听」中心完成内容**：
    - `public/js/storage.js` 新增 `xyzp_v1_favorites` 播客收藏（提取 `xyzrank` `links` 中的 RSS `xmlUrl`）、富元数据收听进度持久化（保留 `title`、`podcastName`、`pid`、`image`、`enclosureUrl`）、`exportUserDataObject` / `parseAndMergeBackupJson`（按更新时间戳智能合并收听记录与收藏）以及标准 **OPML 2.0** 生成器 `buildOpmlXml`。
    - 新建 `public/js/components/LibraryDrawer.js` 并接入 `overlayHistory.js` (`"library"`) 与 `app.js` 顶栏书签入口（含 `400px` 以下窄屏紧凑排布防溢出）：包含「关注播客」与「收听历史」双 Tab、一键续播/重播、单条移除/清空历史 5 秒撤销，以及底部 JSON 导出、JSON 导入恢复、OPML 导出。
    - `PodcastView.js`、`EpisodeView.js` 与 `RankBoard.js` 全面接入关注/取消关注按钮与四榜 `已关注` 标签高亮。
  - **PC 全局快捷键完成内容**：
    - `public/js/utils.js` 新增 `shouldIgnoreGlobalHotkey(event)`（自动避让 `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable`、修饰键、IME 输入法组合及按钮/链接上的 `Space`）；`app.js` 监听全局按键支持 `Space`（播放/暂停）、`←`/`→`（-15s/+30s）、`[`/`]`（步进倍速）、`M`（静音切换，同步更新 `PlayerBar.js` 全屏静音按钮与迷你栏提示）、`/`（聚焦榜单搜索框），并在 `AboutDialog.js` 与 `PlayerBar.js` 补充快捷键提示。
    - `test/frontend.test.js` 新增收藏、RSS 提取、富历史保留、JSON 导入合并冲突消解、OPML XML 转义及全局热键守卫单测。
  - **验证结果**：用户本地验收通过（2026-11-18）。

- [x] **FEAT-P0-P1**（2026-11-18）一次性完成 P0 稳定性/缓存保护与 P1 核心收听/热榜发现升级
  - **P0 完成内容**：
    - 外链冷启动返回兜底与 404 路由：`app.js` 新增 `smartBack()`、详情页顶栏「热榜」按钮与 `/:pathMatch(.*)*` 404 视图；`EpisodeView.js` / `PodcastView.js` 无站内历史时显示「逛热榜首页」并跳转 `/`，同步补齐详情页结构化骨架节点。
    - Service Worker 弱网安全回退：`public/sw.js` 升至 `v3`，仅在 `req.mode === "navigate"` 时回退 `"/"`，静态脚本/样式使用 `ignoreSearch: true` 缓存匹配，杜绝 ES Module 收到 HTML MIME 报错。
    - D1 查询瘦身与边缘缓存：`schema.js` / `sync.js` / `boards.js` 将分类聚合缓存于 `app_state` (`genres:<syncVersion>`) 并在旧版本清理时回收；`/api/boards/meta` 与 `/api/boards/:board` 增加 `Cache-Control` 响应头及按 `syncVersion` 隔离的 Worker `caches.default` 边缘缓存。
    - 深色防闪白与同步超时：`index.html` 内联脚本在首屏渲染前同步 `data-theme` 与 `theme-color`（未手动设置时跟随系统 `prefers-color-scheme`）；`sync.js` `fetchBoardPage` 增加 12s `AbortController` 超时；清空废弃 `src/handlers/download.js` 代码。
  - **P1 完成内容**：
    - 热评时间戳一键空降：`utils.js` 新增纯函数 `parseTextWithTimestamps(text, maxSeconds)`（`test/frontend.test.js` 单测覆盖），`EpisodeView.js` 在热评正文与二级回复中无 `v-html` 渲染可点击跳播按钮。
    - 睡眠定时器：`app.js` + `PlayerBar.js` 新增 `关闭 / 播完本集 / 15分 / 30分 / 45分 / 60分` 定时功能，支持实时倒计时显示与结束前 3 秒音量渐弱淡出。
    - 榜单升降趋势、单集直跳频道与已听标记：`boards.js` 通过索引点查关联上一期 `prev_rank` 与所属播客 `podcast_pid`（`test/schema.test.js` 与 `test/sync.test.js` 单测覆盖）；`RankBoard.js` 移动端（保持 18px 排名列宽不破坏 28px 左对齐）与桌面端展示 `↑ / ↓ / 新(NEW)`、可点击播客名跳转 `/podcast/:pid` 及 `已听 XX% / 已播完` 标记。
    - 锁屏进度同步与队列增强：`app.js` 接入 `navigator.mediaSession.setPositionState` 与音频报错自动强制刷新 `enclosureUrl` 重试；`PlaylistDrawer.js` 与 `EpisodeView.js` 新增「下一首播放」、「清已播」，并为单删、清已播、清空队列统一提供 5 秒撤销。
  - **验证结果**：用户本地验收通过（2026-11-18）。

- [x] **PERF-03** 将微信字号脚本内联到 CSS 之前，按需库加载器合入已有 `utils.js`，减少首屏请求。
  - 本地 Wrangler + Chromium，390px 冷缓存首页 JS 请求 18 → 16（同源 15 → 13，CDN 3）。5 个固定地址均直接返回 HTTP 200。真实 DOMPurify / SortableJS 验证简介净化、时间戳和队列初始化，微信桥接模拟通过。单测 18/18。

- [x] **PERF-02** 使用实测 Location 固定五个版本。Vue、Vue Router、Lucide 用 `defer`，在应用入口前按序执行。进入单集页加载 DOMPurify，打开有内容的队列时加载 SortableJS。
  - 4 个测试文件通过。静态检查确认首屏只请求 3 个 CDN 脚本。模拟验证简介等待期间详情可用、净化失败不渲染原始 HTML、加载失败可重试、队列关闭后不创建拖拽实例及重新打开正常。实际 CDN 请求待联网复核。

- [x] **PERF-01** 入口页 5 个 unpkg 脚本均固定完整版本号，保留原文件路径及加载顺序。
  - 核对发布记录及 unpkg 文件目录，HTML 检查确认 5 个链接均为完整版本，`npm test` 的 4 个测试文件通过。当前环境无法解析 unpkg 域名，HTTP 状态和重定向次数待联网复核。

- [x] **DOC-01** README将Fork+Workers Builds控制台部署提前为主路径；写明自建D1替换原作者ID、空构建命令、Cloudflare内自动迁移再部署、D1令牌权限，以及运行时密钥/首次Cron等待/控制台SQL查询。新增已有Worker关联Git步骤，终端部署折叠为进阶选项，并删除已下线下载API文档。
  - 核对Cloudflare官方Builds/配置/D1迁移/Secrets/Cron文档；README TOML与仓库配置、npm脚本映射、内存SQLite执行迁移和只读SQL、文档顺序及代码围栏检查通过，`npm test`全部4个测试文件通过，diff检查通过。
  - 本轮只改文档，未连接Cloudflare仓库或部署，也未修改原Worker/D1配置；线上Git构建仍需用户按步骤连接。当前环境`.git`只读，创建index.lock失败，文档改动已留在工作区但未能提交。

- [x] **UI-22** 四榜Tab点击/横滑使用replace共用当前历史位置，详情仍push并正确返回最近榜单及滚动位置，资源v27。
  - Chromium/WebKit 390/1280px验证连续点击四榜history.length与position不增长，手机横滑同样replace；进入频道页仅新增1步，后退返回最后榜单并恢复500px滚动及audio实例；项目介绍返回优先关闭正常，再切榜单后一次返回直接到先前站点文档。页面错误0。
  - `npm test`18/18、JS语法与diff检查通过；未部署。

- [x] **UI-21**（2026-11-18）移动端榜单列表左右滑动切换相邻Tab：左滑下一个、右滑上一个，首尾不循环，保留各榜单滚动状态和全局音频实例，资源v26。
  - 仅<768px榜单页启用；12px方向锁、64px切换阈值、横向位移>纵向1.5倍且700ms内完成。排除控件、24px屏幕边缘、弹层、双指/取消手势，纵向起手不会中途触发横滑，拦截横滑后的误点击。
  - Chromium原生触摸320/390px四榜双向及首尾、短滑/斜滑/纵滑、600px滚动恢复、音频实例和正常卡片点击通过；1280px不切换。Chromium/WebKit事件验证控件/多指/取消/边缘/弹窗排除和路由后退通过，页面错误0。
  - `npm test`18/18，JS语法及diff检查通过；未部署，实体手机手感待复核。

- [x] **UI-20** 评论二级回复仅在至少3条时折叠并显示展开/收起，1～2条完整展示且无渐隐。资源版本v25。
  - Playwright 390/1280px验证0/1/2/3条边界、1～2条长回复不裁切也无mask、3条展开/收起高度及aria状态通过，页面错误0；`npm test`18/18，JS语法/diff检查通过；未部署。

- [x] **UI-19** 微信内保持设计字号：新增提前执行的 `wechatFont.js`，桥接立即可用/延迟就绪时恢复默认缩放，监听menu:setfont及pageshow，防重复订阅，接口不支持时安全降级；仅MicroMessenger环境启用。微信作用域html/body text-size-adjust固定100% important，保持普通浏览器与双指缩放原行为，资源v24。
  - Chromium/WebKit各5组桥接mock（立即/延迟/缺失/抛错/非微信）通过，页面错误0、布局尺寸保留；Chromium模拟body内联180%仍计算为100%。Linux WebKit不实现该CSS文字缩放属性，仅验证样式声明与桥接逻辑，未冒充微信原生实测。
  - `npm test`18/18、JS语法与diff检查通过；未部署，iOS/Android微信真机需部署后复核。

- [x] **UI-18** 修复项目介绍弹窗触摸滚动穿透，保留长弹窗内部滚动与关闭后的列表位置。
  - AboutDialog局部非passive触摸监听：遮罩、无溢出内容、顶部向下/底部向上滑动时preventDefault；可滚动方向交给弹窗自身，不修改根页面定位。资源版本v23。
  - Chromium原生触摸滑动验证390×844无溢出、390×480内部滚动及上下边界/遮罩均不带动600px处背景；关闭后位置保留且列表可继续滑动。WebKit两种高度触摸事件取消与内部允许滚动验证通过，页面错误0。
  - `npm test`18/18、JS语法与diff检查通过；本次未部署，实体手机待复核。

- [x] **UI-17** 修正手机端 Shownotes 渐隐：用88px背景渐变叠层替换mask-image依赖，展开/收起文案改主题强调色并加字重，资源版本升v22。
  - Chromium及WebKit均通过320/390/1280px浅深色、240px折叠/展开/收起、键盘、重载及动态高度验证，页面错误0；截图 `/tmp/xyz-review/notes-webkit-*.png`。WebKit测试禁用Service Worker以确保mock数据重载仍被拦截。
  - `npm test`18/18、diff检查通过；尚未部署本次修正，实体手机仍待用户复核。

- [x] **UI-16** 对照官网为长 Shownotes 增加240px默认预览、64px渐隐及展开/收起，短内容保持完整展示。
  - ResizeObserver测量实际正文高度；折叠正文inert避免键盘进入隐藏内容，展开可点击时间戳；收起长文滚动回简介区，重新加载默认收起。
  - Playwright 320/390/1280px浅深色、键盘展开、动态高度变化、重载及六组时间戳提示验证通过；真实节目4254px正文展开后时间戳正常启动迷你播放器，页面错误0。`npm test`18/18，JS语法/diff检查通过；未部署。

- [x] **UI-15** Header Logo 打开项目介绍模态框，包含项目用途、收听功能、来源致谢和 GitHub `icheer/xyz-podcast`。
  - 接入同URL历史；Playwright 320/390/1280px浅深色布局、返回/前进、关闭按钮、Esc、遮罩、键盘焦点循环与450px滚动位置保留验证通过，页面错误0。
  - `npm test`18/18、JS语法及diff检查通过；未部署。

- [x] **UI-14** 全屏播放器/队列通过同URL的Vue Router历史状态管理：返回依次关闭顶层弹层，之后再后退页面；手动关闭消费对应历史条目，播放器内导航先清理弹层历史再进详情。
  - 新增 `public/js/overlayHistory.js`，同URL导航不改变底层滚动；保留单一audio实例。队列删除最后一集时可移除播放器层历史并保留队列撤销；打开/关闭请求串行处理避免双击产生重复历史。
  - Playwright手机/桌面验证返回/前进/嵌套队列/手动收起/Escape/播放器内进详情/直接进入单集页/刷新展开态/连续快速返回/最后一集撤销及重复展开通过；底层滚动、音频实例、滚动锁清理正常，页面错误0。
  - `npm test`18/18，JS语法及diff检查通过；未部署。

- [x] **UI-13** 旧页面同步退出，详情仅保留120ms透明度淡入，去掉上移位移与旧页100ms淡出，避免滚动归零时仍显示旧列表。
  - Playwright帧采样复现修改前手机/桌面各7帧旧列表已归零但仍可见；修改后390/1280px均0帧。榜单及频道进入详情、后退恢复1100/1099px及频道原位置、减少动态效果设置通过，页面错误0。
  - `npm test`18/18、JS语法及diff检查通过；未部署。

- [x] **DATA-02** 核查Worker/浏览器现有请求头与浏览器限制。
  - 代码核查：xyzrank同步已有UA/Referer/Accept；Worker小宇宙抓取已有UA/Referer/Accept/Accept-Language；浏览器详情请求为cors+omit+no-referrer，保留真实浏览器生成的Origin/UA等。
  - 官方资料核对：MDN Forbidden request header、RequestInit、CORS-safelisted request header；Cloudflare HTTP headers文档确认fetch子请求附加CF-Worker。浏览器不能任意伪造Referer/Origin/Sec-*；referrer选项仅允许当前来源同源URL等合法值，额外非安全列表头可能引入CORS预检。
  - 建议：现有头无需为假设的未来反爬而堆叠；保持简单GET与当前no-referrer，按实际403/429/CORS变化调整，优先控制请求量、退避和故障可观测性。补Referer无法保证不被拦截，也不能消除CF-Worker平台标记。未修改产品代码。

- [x] **DATA-01** 调查网页热评20/21条差异，对比上游原始评论、置顶与解析结果。
  - 抽查线上热门单集前8项官网原始 `__NEXT_DATA__.props.pageProps.comments`：3项21条（1置顶+20普通），3项20条（无置顶），另2项20条（1置顶+19普通）；8项评论ID均唯一，解析后条数及置顶数与原始数据完全一致。
  - 结论：抽样未发现重复计数/多解析的bug；21条由上游提供且样本均含额外置顶评论；有置顶也可能仅20条，不能把21或20作为固定契约。上游服务端如何合并/去重置顶未公开，本次不将推断当作已证实算法。二级回复保留在replies中，不增加父评论列表条数。
  - 证据：`/tmp/xyz-comments/results.json`及8份原始HTML，运行项目parseEpisodePage逐一比对通过，检查官网页面JS也仅见置顶展示逻辑，未找到服务端列表合并实现；未修改产品代码。

- [x] **UI-12** 通过渲染后HTML中的时间戳跳转按钮判断是否显示「点击文内时间戳可跳转」。
  - Playwright六组内容验证：空内容/无时间戳/普通链接时间文本/无效时间不显示，普通有效时间戳及小宇宙原生时间戳显示；页面错误0，JS语法和diff检查通过。

- [x] **UI-11** 顶栏品牌改为「小宇宙播客热榜」，并在README补充定时同步确认方法。
  - 本地Playwright验证名称与390px无溢出；JS语法和diff检查通过。
  - 2026-11-17北京时间20:10只读查询线上D1：`20261117T12`为running，20:00:16启动，75页/7341条，podcasts偏移6400，retry_count=0、last_error=NULL、finished_at=NULL、active_sync_version=NULL，尚未全量完成。公开meta同样isComplete=false。
  - 本地ADMIN_KEY未通过线上管理接口鉴权；本轮通过已登录Wrangler只读查询核实，未手动触发/改写同步、未部署。

- [x] **UI-10** 为html/body、全屏播放器和队列滚动区设置 `overscroll-behavior-y: none`，关闭纵向边界回弹。
  - Chromium触摸事件模拟快速滑至顶部后继续滑动，采样180帧播放栏bottom均为844px；正常列表滚动保留，根页面及弹层计算样式为none，页面错误0，diff检查通过。
  - 未在实体iPhone/Safari验证原生惯性回弹；旧版浏览器不支持该CSS时不能保证屏蔽系统效果。

- [x] **UI-09** 去掉频道单集数据行叠加的顶部padding，数据与描述、按钮间距均设为8px。
  - Playwright验证320/390px全部15条上下间距均为8px，与描述左对齐误差0；1280px无横向溢出，diff检查通过。截图 `/tmp/xyz-ui02/channel-spacing-fixed.png`。

- [x] **UI-08** 频道单集底部整体右缩进64px，四项数据与上方描述文字左边缘对齐，窄屏调整间距保持单行。
  - Playwright验证320/390/1280px全部15条数据与描述左坐标误差小于1px，四项保持单行且无横向溢出；截图 `/tmp/xyz-ui02/channel-stats-text-aligned.png`，diff检查通过。

- [x] **UI-07** 简化频道最新单集卡片：移除详情按钮、整卡进入详情、移动端四项数据独占一行，播放/入队另行排列。
  - 限定榜单数据28px缩进只作用于榜单，避免影响频道列表；收听进度标签与操作放在第二行。
  - Playwright验证320/390/1280px下15条的日期/时长/播放/评论均为单行、无横向溢出；整卡及Enter跳转详情，播放/入队不触发导航；页面错误0，语法与diff检查通过。截图 `/tmp/xyz-ui02/channel-list-fixed.png`。

- [x] **UI-06** 隐藏搜索框浏览器原生清空图标，保留自定义清空按钮。
  - Playwright验证390/1280px输入AI后仅有一个自定义清空按钮，点击后内容清空且按钮隐藏；手机截图确认无重复叉号，`git diff --check`通过。

- [x] **UI-05** 将榜单卡片底部数据行右缩进28px，与封面左边缘对齐。
  - Playwright验证320/390px四榜封面与数据行左坐标一致（误差小于1px），无横向溢出；`git diff --check`通过。

- [x] **UI-04** 移除触摸时刺眼的橘红色焦点描边，将键盘焦点与搜索聚焦改为柔和中性色。
  - Playwright触摸模式验证：打开/关闭队列后按钮无outline；键盘Tab保留1px中性灰焦点；搜索聚焦无阴影、边框为中性色，浅深色均通过；`git diff --check`通过。

- [x] **UI-03** 按用户反馈去掉榜单条目彩色左线，缩小播放/加队列按钮、增加间距并移除加号圆框。
  - 验证：Playwright 实测播放/队列按钮高度28px、间距12px，已入队加号/勾选按钮边框0px且背景透明；卡片无inset彩色左线。播放/暂停、浅深色、320/390/1280px布局通过，页面错误0。截图 `/tmp/xyz-ui02/buttons-fixed.png`。

- [x] **UI-02** 按设计走查逐项改善布局、深色主题、详情阅读与交互动效
  - 完成：手机搜索展开/详情精简顶栏、三列稳定筛选、卡片层级与44px主要触控区、迷你栏精简、桌面可选指标与频道双列头部、长回复折叠、图片失败兜底、结构化骨架、深色按钮变量、自适应队列/调序菜单/置顶/5秒撤销、播放器/抽屉/路由/Toast动效、缓冲旋转、减少动态效果与弹层焦点管理。
  - 修复路由离场动画期间滚动事件可能覆盖列表保存位置的时序问题。
  - 验证：`npm test` 18/18；JS语法及 `git diff --check` 通过；Playwright 390×844、375×667、320×667、1280×800 验证。手机顶栏95.5px、首卡180.5px、四榜首卡位置一致；单条队列178.75px；虚拟DOM12卡；返回恢复1100px；搜索无结果/清空、播放/时间戳、撤销/置顶/15项鼠标拖拽、简介/回复展开、嵌套弹层Escape/焦点/滚动锁、深色按钮、图片兜底及减少动态效果通过，页面错误0。截图 `/tmp/xyz-ui02/`。
  - 未部署；P7-05/P7-06 的其余清理和完整验收保持独立。

- [x] **UI-01** 视觉与交互动效走查，仅提出建议
  - 验证：Browser MCP 成功访问线上/本地桌面页面；Playwright 截图检查 390×844、1280×800、375×667，覆盖四榜、频道/单集、播放/暂停、迷你/全屏播放器、单条队列、21 条热评与深色频道。
  - 发现：手机 Header 146px；播客榜排序方向换行；迷你栏长标题空间不足；单条队列留白过多；深色次要按钮突兀；桌面频道头部与长评论层级待改善。建议及动效规格见 `DESIGN_REVIEW.md`，截图在 `/tmp/xyz-review/`。
  - 环境限制解除后 Wrangler 与浏览器均已运行成功。未修改产品代码或部署，未将本次审查视作 P7-05/P7-06 全面回归验收。

---

## 交接日志（Handover Log）

| 日期 | 阶段/任务 | 完成/变更摘要 | 验证状态 | 遗留/下一步 |
|---|---|---|---|---|
| 2026-11-17 | Phase 0 (`P0-01`~`P0-04`) | 完成 `aigc-gallery`、`xyzrank.com`（4 API）、`xiaoyuzhoufm.com`（SSR `__NEXT_DATA__` 与音频 CDN 头）实测调研；确认 4 项架构决策；创建 `AGENTS.md` 与 `CHECKLIST.md` | 已通过 curl / python 脚本实测上游真实返回 | 进入 Phase 1 |
| 2026-11-17 | Phase 1 (`P1-01`~`P1-04`) | 初始化 `package.json`、`wrangler.toml`、`.gitignore`、`.dev.vars.example`、`migrations/0001_init.sql`、`src/index.js`、`src/utils/http.js`、`src/db/schema.js`、`public/index.html` 占位与 `test/schema.test.js` | `wrangler d1 migrations apply --local` 成功；`wrangler dev` `/api/health` 返回 200；`npm test` 4/4 通过 | 进入 Phase 2 |
| 2026-11-17 | Phase 2 (`P2-01`~`P2-04`) | 实现 `src/db/sync.js` 分批接力状态机（`DEFAULT_MAX_PAGES_PER_BATCH=15`）、`src/handlers/admin.js`、`src/handlers/boards.js`、接入 `scheduled()` 并修复 `wrangler.toml` `run_worker_first` 放行 `/__scheduled`；新增 `test/sync.test.js` | `npm test` 10/10 通过；`wrangler dev --test-scheduled` 实测拉取 `xyzrank.com` 全量 9,132 条入 D1，`/api/boards/*` 搜索/分类/排序正常 | 进入 Phase 3 |
| 2026-11-17 | Phase 3 (`P3-01`~`P3-04`) | 消除多余嵌套目录将仓库移至根路径；验证小宇宙官网支持浏览器 CORS 直连（`access-control-allow-origin` 动态回显 Origin），将解析器抽至前后端共享 `public/js/xyzParser.js`，后端保留 `XYZ_RELAY_URL` 可选兜底与 `/api/audio/download` | `npm test` 15/15 通过；真实浏览器（Playwright+Obscura）实测从 `http://127.0.0.1:8787/` CORS 请求小宇宙播客页与单集页均返回 `200` 并成功解析 | 进入 Phase 4 (`P4-01`~`P4-04`) |
| 2026-11-17 | Phase 4 ~ 7 (`P4-01`~`P7-03`) | 完成全部 Vue 3 Options API 前端视图（4 榜单/频道页/单集页）、全局播放器与播控抽屉、`SortableJS` 列表调序、`localStorage` 续播、Shownotes 时间戳跳转及 `test/frontend.test.js` | `npm test` **19/19** 通过；Playwright + Obscura 实测手机 (`390x844`) 与桌面 (`1280x800`) 全流程通过，0 控制台/页面报错 | 推进 `P7-04` / `P7-05` |
| 2026-11-17 | `P7-04` ~ `P7-06` | 完成线上首次部署（`https://xyz-podcast.icheer.workers.dev`）；新增 PWA、两段式卡片、骨架屏、`PlaylistDrawer` `min-height: 56vh`、`<keep-alive>` + `scrollKeeperMixin`；移除前后端音频下载功能、固定全局 `.site-header` 并接入 `--header-h` 观测、实现 `RankBoard` 移动端与桌面端虚拟滚动及单测、更新 `README.md` | PWA 与抽屉高度在上一轮通过；`P7-05` 收尾与 `P7-06` 改动因旧 `cwd` 被删未运行终端命令 | 在 `/home/projects/_ai-apps/xyz-podcast` 删除 `src/handlers/download.js`、运行 `npm test`、页面实测后提交并 `npm run deploy` |

| 2026-11-17 | UI-01 | 完成真实浏览器视觉走查并更新 DESIGN_REVIEW.md，提出布局、深色主题与动效建议 | MCP + Playwright 手机/桌面/短屏截图及操作通过 | 等待用户决定设计实施范围；P7 状态保持 |

| 2026-11-17 | UI-02 | 落实视觉审查建议，完善响应式布局、队列与动效，并修复离场滚动保存时序 | npm test 18/18；手机/桌面/短屏及拖拽、键盘、减少动效浏览器验证通过 | 本地完成，未部署 |

| 2026-11-17 | UI-03 | 按反馈移除条目彩色左线，按钮改28px并留12px间距，加号/勾选不带圆框 | Playwright浅深色/三种宽度、播放暂停及样式实测通过 | 未部署 |

| 2026-11-17 | UI-04 | 移除橘红色焦点描边及搜索光晕，保留中性灰键盘焦点 | Playwright触摸/键盘/浅深色搜索实测通过 | 未部署 |

| 2026-11-17 | UI-05 | 卡片底部数据与封面左边缘对齐 | Playwright 320/390px四榜坐标检查通过 | 未部署 |

| 2026-11-17 | UI-06 | 隐藏原生搜索清空图标，消除双叉号 | Playwright手机/桌面输入与清空、手机截图检查通过 | 未部署 |

| 2026-11-17 | UI-07 | 删除频道详情按钮、支持整卡导航，移动四项数据与操作分行 | Playwright三种宽度15条单行检查及点击/键盘验证通过 | 未部署 |

| 2026-11-17 | UI-08 | 频道单集数据与描述文字对齐 | Playwright三种宽度15条坐标、单行及溢出检查通过 | 未部署 |

| 2026-11-17 | UI-09 | 频道四项数据行上下留白统一8px | Playwright两种手机宽度15条间距检查及桌面溢出检查通过 | 未部署 |

| 2026-11-17 | UI-10 | 关闭根页面与弹层纵向边界回弹 | Chromium快速触摸滑动180帧播放栏位置稳定，仍需实体Safari核对 | 未部署 |

| 2026-11-17 | UI-11 | 修改品牌名称并说明定时同步检查方法 | 本地名称验证通过；20:10线上D1查询该轮仍running且无错误 | 等待正常Cron继续接力；本轮未部署 |

| 2026-11-17 | UI-12 | 仅存在真实时间戳跳转按钮时显示提示 | Playwright六组内容可见性验证通过 | 未部署 |

| 2026-11-17 | DATA-01 | 核实20/21热评差异来自上游原始列表，未发现本项目重复计数 | 8份官网原始HTML与项目解析器逐一比对通过 | 按上游实际条数展示 |

| 2026-11-17 | DATA-02 | 对照现有请求构造和官方文档评估Referer等标头 | 代码/MDN/Cloudflare资料核查完成 | 保持当前请求头，无产品变更 |

| 2026-11-17 | UI-13 | 消除列表进入详情前的归零闪跳，缩短新页淡入 | 手机/桌面帧采样旧列表顶部可见帧7→0，榜单/频道后退恢复通过，单测18/18 | 未部署 |

| 2026-11-17 | UI-14 | 全屏播放器和队列历史状态支持物理返回优先关闭弹层 | 手机/桌面返回前进/刷新/嵌套/快速返回及音频滚动保留验证通过；单测18/18 | 未部署 |

| 2026-11-17 | UI-15 | Logo 项目介绍弹窗与 GitHub 入口 | 320/390/1280px浅深色、返回前进、键盘/遮罩关闭、焦点及滚动保留通过；单测18/18 | 未部署 |

| 2026-11-17 | UI-16 | Shownotes 默认折叠与渐隐预览 | 手机/桌面浅深色、键盘、动态高度、重载和真实时间戳播放通过，单测18/18 | 未部署 |

| 2026-11-17 | UI-17 | 修正手机简介渐隐与展开/收起文字颜色 | Chromium/WebKit三种宽度浅深色与交互通过，单测18/18 | 本次修正未部署 |

| 2026-11-17 | UI-18 | 项目介绍弹窗触摸边界拦截，修复背景列表穿透 | Chromium原生手势及WebKit事件验证通过，长弹窗可滚动，关闭后位置和手势恢复；单测18/18 | 未部署 |

| 2026-11-17 | UI-19 | 微信设计字号锁定与桥接兼容降级 | 两引擎10组mock通过，Chromium文字缩放覆盖验证及单测18/18通过 | 未部署，微信真机待复核 |

| 2026-11-17 | UI-20 | 至少3条二级回复才折叠，少量回复去掉渐隐和按钮 | 手机/桌面0～3条及长回复完整展示、展开/收起通过；单测18/18 | 未部署 |

| 2026-11-18 | UI-21 | 移动端榜单左右横滑切换4个Tab，保护纵滚/控件/边缘及弹层 | Chromium原生320/390px与桌面回归、WebKit事件边界检查通过；单测18/18 | 未部署 |

| 2026-11-18 | UI-22 | 四榜切换共用浏览器历史位置，详情返回最近榜单 | Chromium/WebKit手机桌面连续切榜、详情/弹窗后退与滚动恢复通过；单测18/18 | 未部署 |

| 2026-11-18 | DOC-01 | README推荐Fork+Cloudflare Git部署，补充已有Worker迁移与D1自动建表/权限 | 官方文档核对、TOML/npm映射/SQLite SQL/Markdown检查及4个测试文件通过 | 未操作线上Worker，Git关联需在控制台完成 |
| 2026-11-18 | PERF-01 | 固定入口页 5 个 unpkg 脚本版本 | 发布记录、文件路径、HTML 和 4 个测试文件检查通过 | CDN 请求待联网复核 |
| 2026-11-18 | PERF-02 | 首屏脚本 defer，简介净化与队列拖拽按需加载 | 4 个测试文件及加载顺序、延迟、失败和队列状态模拟通过 | CDN 请求待联网复核 |
| 2026-11-18 | PERF-03 | 内联微信首屏初始化，合并按需库加载器 | Chromium 首页 JS 18 → 16，CDN 直接 200，主要功能及单测 18/18 通过 | 本地验证 |
| 2026-11-18 | FEAT-P0-P1 | 完成 P0（深链返回/404、SW修复、D1分类缓存+Edge Cache、深色防闪白、同步超时）与 P1（热评时间戳跳播、睡眠定时、榜单升降/新上榜+频道直跳+已听标记、锁屏进度同步、队列下一首/清已播/清空撤销、音频失效重刷）及新增单测 | 用户本地验收通过 | 已合入后续交付 |
| 2026-11-18 | FEAT-P2 | 新增免登录本地「我的收听」抽屉（关注播客、收听历史、JSON 备份恢复、OPML 2.0 导出）、四榜与内页关注联动，以及 PC 全局播控快捷键（`Space` / `←` / `→` / `[` / `]` / `M` / `/`）与单测 | 用户本地验收通过 | 进入 `REFACTOR-P3` |
| 2026-11-18 | REFACTOR-P3 | 重构单源化 `public/css/app.css`（消除尾部约 80 处重复级联覆盖、合并 5 处分散媒体查询为 11 个清晰章节）、抽离公共 `formatProgressBadge` 统一 4 处进度文案、为详情内存缓存增加 60 条上限淘汰、清理组件内联样式 | 代码与单测已静态复核（本会话绑定旧 cwd 未执行终端） | 在根目录运行 `npm test` 与快速回归后提交部署 |
