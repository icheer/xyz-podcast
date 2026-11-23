# AGENTS.md — XYZ Podcast (小宇宙热门播客收听端)

> 本文档是跨会话、多 Agent 接力开发的**唯一架构权威与交接规范**。任何 Agent 接手前必须先阅读本文件与 `CHECKLIST.md`，并在每次任务推进时**实时同步更新进度**，确保文档与代码现状严格一致。

---

## 1. 项目定位与核心目标

基于民间小宇宙热门榜单站 [xyzrank.com](https://xyzrank.com/) 的 4 个榜单数据与 [xiaoyuzhoufm.com](https://www.xiaoyuzhoufm.com/) 官网公开页面内容，构建一个**手机端优先、兼顾 PC 端**的播客发现与在线收听 Web 应用。

- **技术形态**：Cloudflare Workers 全栈单仓库（参考 [icheer/aigc-gallery](https://github.com/icheer/aigc-gallery) 的无前端构建模式）。
- **数据策略**：
  1. **首页 4 大榜单**由 Cloudflare Cron 每天北京时间 `08:00`（UTC `00:00`）启动一轮同步，通过兼容 Cloudflare Free Plan 的**分批接力状态机**抓取 `xyzrank.com` 全量数据并存入 **Cloudflare D1 (SQLite)**，再由自建 `/api/boards/*` 对外提供搜索、排序与分页服务。
  2. **播客频道页 & 单集播放页**均内置在本项目前端路由中（保留"去小宇宙官网"外链），所需数据（频道单集列表、单集音频地址、Shownotes、热评列表）采用**浏览器端直连 CORS `fetch` 为主 + 后端可选 `XYZ_RELAY_URL` 转发兜底**的实时按需方案（复用同一份纯函数解析器 `public/js/xyzParser.js`），**不做预取与数据库缓存**。
  3. **音频在线收听**：直接由 `<audio src="https://media.xyzcdn.net/...">` 流式播放；出于版权合规考虑，项目不提供音频文件下载按钮与下载代理接口。
- **核心收听体验**：全局常驻迷你播放器 + 可展开全屏播控页（切换榜单/逛频道不断播）、向前 30 秒 / 向后 15 秒、倍速调节、循环模式（顺序 / 单曲 / 列表循环）、播放列表与拖拽调序、基于 `localStorage` 的断点续播进度保存与恢复、固定顶栏与榜单虚拟滚动。
- **已知边界**：小宇宙官网网页端不提供逐字稿正文（仅 App 端有），本项目不实现字幕/逐字稿功能。

---

## 2. 技术栈与目录规划

### 2.1 运行时与后端
- **Cloudflare Workers** + **Wrangler v4**（无 TypeScript 编译/打包器需求，直接原生 ES Modules JS）。
- **存储**：**Cloudflare D1 (SQLite)**，Binding 名为 `DB`。
- **静态资源托管**：Workers Static Assets (`[assets]` 配置 `directory = "./public"`，`binding = "ASSETS"`，`not_found_handling = "single-page-application"`，`run_worker_first = ["/api/*", "/__scheduled"]`)，实现零构建多文件拆分与 SPA History 路由兜底。
  - 若需极简内嵌单文件方案，也可参考 `aigc-gallery` 的 `import indexHtml from "../public/index.html" with { type: "text" }`，但本项目含 3 类视图 + 全局播放器 + 播放列表抽屉，**优先使用 `public/` 多文件 + `[assets]`** 以避免单文件膨胀导致后续 Agent 编辑困难。

### 2.2 前端（零构建，CDN / unpkg）
- **核心框架**：`vue@3.5.45/dist/vue.global.prod.js`（**严格使用 Options API 风格**，不用 `<script setup>` / Composition API / `.vue` 单文件编译）。
- **路由**：`vue-router@4.6.5/dist/vue-router.global.prod.js`（HTML5 History 模式配合 Worker SPA fallback）。
- **第三方 JS 库**：`unpkg.com` 链接写明完整版本及文件路径。Vue、Vue Router 和 Lucide 通过 `defer` 按序在应用入口前执行。
  - `dompurify@3.4.18/dist/purify.min.js` 在进入单集页时与详情请求并行加载。节目简介在净化完成后渲染，净化不可用时显示提示，播放和评论可照常使用。
  - `sortablejs@1.15.7/Sortable.min.js` 在打开有条目的播放列表时加载。加载失败时仍可使用上移、下移等调序按钮。
  - `lucide@1.74.0/dist/umd/lucide.min.js` 由 `AppIcon.js` 用于渲染线性图标。
- **脚本组织**：首屏前就必须执行的小段初始化可放在 `index.html`，例如微信字号锁定。通用浏览器辅助逻辑放在已有的 `utils.js`，独立视图和业务模块按职责组织。
- **图片加载**：组件通过 `v-cover` 设置图片地址，长简介插图在净化后使用同一个 `smallImageUrl`。小宇宙图片 CDN `image.xyzcdn.net` 和榜单图片域名 `xyzrank.justinbot.com` 统一使用单个 `@small`，其他域名及本地图片沿用原地址。榜单代理缩略图加载失败且路径中包含可还原的 HTTPS 原图地址时，`v-cover` 重试一次原图，仍失败则使用占位图。
- **CSS 设计**：原生 CSS 变量 + 移动优先响应式布局（`< 768px` 手机卡片流，`>= 768px` PC 自适应宽布局/表格）；**浅色高对比播客风**，并通过 CSS 变量预留后续夜间模式扩展能力。

### 2.3 目标目录结构

> 注：当前仓库尚处于规划阶段，以下为实施目标结构，已创建的文件会在 `CHECKLIST.md` 与第 8 节现状中标注。

```text
xyz-podcast/
├── AGENTS.md                 # 本架构与交接规范
├── CHECKLIST.md              # 实施清单与实时进度追踪
├── CLAUDE.md                 # Claude Code 入口指引（已保留 Codeman 规则）
├── package.json              # wrangler devDependency 与常用脚本
├── wrangler.toml             # Worker 配置（D1 binding: DB、ASSETS、Cron trigger）
├── .dev.vars                 # 本地密钥（不提交 git，如 ADMIN_KEY）
├── .dev.vars.example         # 本地密钥模板
├── .gitignore                # 忽略 node_modules、.wrangler、.dev.vars、.env
├── .github/workflows/ci.yml  # GitHub Actions：推送到 main 和 PR 时运行 npm run check
├── eslint.config.js          # ESLint 扁平配置：eslint:recommended，按目录声明 Workers / 浏览器 / Node 全局变量
│   （devDependency @vue/compiler-dom 与 index.html 的 Vue 版本必须一致，由 smoke 测试校验）
├── migrations/
│   ├── 0001_init.sql         # D1 初始表结构
│   └── 0002_rank_composite_keys.sql # 迁移榜单联合主键与索引
├── src/
│   ├── index.js              # Worker 入口：fetch() 路由分发 + scheduled() Cron 入口
│   ├── db/
│   │   ├── schema.js         # D1 查询/UPSERT/版本切换辅助函数
│   │   └── sync.js           # xyzrank 分批接力同步状态机
│   ├── handlers/
│   │   ├── boards.js         # /api/boards/* 榜单查询、搜索、排序、分页、元信息
│   │   ├── xiaoyuzhou.js     # /api/xiaoyuzhou/podcast/:pid 与 /episode/:eid 实时抓取解析
│   │   ├── health.js        # /api/health：D1 连通性与榜单数据年龄（sync.stale）
│   │   └── admin.js          # /api/admin/sync 手动同步与状态查询（ADMIN_KEY 鉴权）
│   └── utils/
│       ├── alert.js          # 可选的同步告警：向 ALERT_WEBHOOK_URL 发送通知
│       ├── freshness.js      # 转发导出 public/js/freshness.js（前后端共享的榜单过期判断）
│       ├── http.js           # JSON 响应、CORS/缓存头、参数与 ID 白名单校验
│       └── parser.js         # 转发导出 public/js/xyzParser.js（前后端共享单一解析器）
├── public/
│   ├── index.html            # SPA 入口 HTML（引入 CDN Vue3 / Router / unpkg 依赖 + PWA meta）
│   ├── site.webmanifest      # PWA 清单（standalone 沉浸式 + 图标声明）
│   ├── sw.js                 # 轻量 Service Worker（静态壳网络优先，不缓存 /api/* 与跨域请求）
│   ├── icon.svg              # 矢量应用图标
│   ├── icon.png              # 256x256 Apple Touch 图标
│   ├── icon-192.png          # 192x192 PWA 图标
│   ├── icon-512.png          # 512x512 PWA 图标
│   ├── css/
│   │   └── app.css           # CSS 变量、移动端卡片流、PC 适配、播放器与抽屉样式
│   └── js/
│       ├── xyzParser.js      # __NEXT_DATA__ 提取与字段清洗（前后端共享纯函数 ES 模块）
│       ├── api.js            # 前端 fetch 封装（榜单 API + 小宇宙浏览器 CORS 直连 & 后端兜底）
│       ├── overlayHistory.js # 播放器/队列同URL历史状态，返回优先关闭弹层
│       ├── storage.js        # localStorage 管理：播放列表队列、断点续播进度、倍速/循环设置
│       ├── utils.js          # 时长格式化、时间戳、按需加载 DOMPurify 和 SortableJS
│       ├── freshness.js      # 榜单数据是否已过期（25 小时），页面提示与 /api/health 共用
│       ├── components/
│       │   ├── AboutDialog.js    # 项目介绍模态框、桌面端快捷键说明与 GitHub 入口
│       │   ├── AppIcon.js        # Lucide UMD SVG 安全包装组件（避免 Vue VDOM 冲突）
│       │   ├── LibraryDrawer.js  # 本地「我的收听」抽屉（关注播客、收听历史、JSON 备份恢复、OPML 导出）
│       │   ├── RankBoard.js      # 4 榜单展示组件（虚拟滚动卡片/表格、搜索/排序/加载更多、关注标记）
│       │   ├── PodcastView.js    # 播客频道页（简介 + 关注播客 + 最新 15 集 + 快捷播放/加队列）
│       │   ├── EpisodeView.js    # 单集播放页（频道关注、Shownotes 与热评时间戳跳转）
│       │   ├── PlayerBar.js      # 底部迷你播放器 + 展开全屏播控页（-15s/+30s/倍速/循环/静音/睡眠定时）
│       │   └── PlaylistDrawer.js # 播放列表抽屉（SortableJS 拖拽排序 + 下一首/清已播/移除撤销）
│       └── app.js            # Vue 3 Options API 根实例、VueRouter 初始化、全局音频控制器
└── test/                     # Node 内置 test runner (node --test) 单元测试
    ├── helpers/
    │   └── sqliteD1.js        # 基于 node:sqlite 的最小 D1 绑定：真实迁移和 SQL、meta.changes、按 D1 口径计查询次数
    ├── alert.test.js          # 告警 webhook：未配置不发、JSON 与 {text} 两种地址、投递失败不抛错
    ├── api.test.js            # 小宇宙详情的浏览器直连与 Worker 兜底流程（替换全局 fetch）
    ├── boards.test.js         # 榜单接口：排序、搜索、分页、趋势及每次请求的 COUNT(*) 次数
    ├── player.test.js         # 根组件真实 methods + 假 <audio>：已播完标记、移除当前单集后的播放状态
    ├── frontend.test.js     # 工具函数、本地存储、收听进度与「数据未更新」提示文案
    ├── health.test.js        # /api/health 的数据年龄与过期判断
    ├── parser.test.js
    ├── schema.test.js
    ├── smoke.test.js          # 冒烟：每个模块可解析、导入的导出存在、组件模板可被 Vue 编译器编译
    └── sync.test.js           # 同步状态机：接力、查询预算、断点续传、加锁、退避、兜底窗口与告警
```

---

## 3. 已验证上游接口与数据契约（实测事实）

以下接口格式已在 2026-11-17 实测验证，后续实施可直接依据以下字段建模。

### 3.1 `xyzrank.com` 4 个榜单 API

- 请求需携带 `Referer: https://xyzrank.com/` 与合理 `User-Agent`。
- **关键约束（已实测）**：4 个接口均强制 `limit` 上限为 **`100`**（传入更大值会被服务端截断为 100），通过 `offset` 分页。

| 榜单 Key (`board`) | 前端路由 | 上游 API | 条目类型 | 2026-11-17 实测规模 | 点击主行为 |
|---|---|---|---|---|---|
| `episodes` | `/` | `https://xyzrank.com/api/episodes` | 单集 | `total = 791` (~8 页) | 进 `/episode/:eid` |
| `podcasts` | `/hot-podcasts` | `https://xyzrank.com/api/podcasts` | 播客 | `total = 8191` (~82 页) | 进 `/podcast/:pid` |
| `new-episodes` | `/hot-episodes-new` | `https://xyzrank.com/api/new-episodes` | 单集 | `total = 19` (1 页) | 进 `/episode/:eid` |
| `new-podcasts` | `/new-podcasts` | `https://xyzrank.com/api/new-podcasts` | 播客 | `total = 131` (2 页) | 进 `/podcast/:pid` |

- **返回结构**：`{ items: [...], total: number, offset: number, limit: number, medianValues: {...} }`
- **单集榜字段 (`episodes` / `new-episodes`)**：
  - `rank`, `title`, `podcastID` *(注意：为 MD5 内部 ID，**不是**小宇宙 `pid`)*, `podcastName`, `logoURL`, `link` *(形如 `https://www.xiaoyuzhoufm.com/episode/<eid>`)*, `playCount`, `commentCount`, `subscription`, `duration` *(**单位：分钟**)*, `postTime` *(ISO 字符串)*, `primaryGenreName`, `totalEpisodesCount`, `openRate`, `lastReleaseDateDayCount`。
  - 前端/入库提取：`eid` 从 `link` 正则 `/\/episode\/([a-zA-Z0-9]+)/` 提取；互动率 `interactiveRate = playCount > 0 ? commentCount / playCount : 0`。
- **播客榜字段 (`podcasts` / `new-podcasts`)**：
  - `id` *(MD5 内部 ID，**非**小宇宙 `pid`)*, `rank`, `name`, `logoURL`, `primaryGenreName`, `authorsText`, `trackCount`, `lastReleaseDate`, `lastReleaseDateDayCount`, `firstEpisodePostTime`, `activeRate`, `avgDuration` *(分钟)*, `avgPlayCount`, `avgUpdateFreq` *(**单位：小时**，展示时 `/ 24` 为天数)*, `avgCommentCount`, `avgInteractIndicator`, `avgOpenRate`, `links` *(数组，首项通常为 `{ name: "xyz", url: "https://www.xiaoyuzhoufm.com/podcast/<pid>" }`)*。
  - 入库提取：从 `links` 查找 `name === "xyz"` 或 URL 匹配 `/\/podcast\/([a-zA-Z0-9]+)/` 提取小宇宙 `pid`。

### 3.2 `xiaoyuzhoufm.com` 实时抓取契约（浏览器 CORS 直连 + Worker 可选转发）

> ✅ **2026-11-17 实测结论与最终方案**：
> - **Cloudflare Workers 出站限制**：`workerd` 与线上 Workers 平台会在所有出站 `fetch()` 上强制注入 `CF-Worker` 请求头且无法在 Worker 代码中移除；`www.xiaoyuzhoufm.com`（`Potato-Server` / OpenResty）会对携带 `cf-worker` 的请求返回 **`HTTP 403 Forbidden`**。
> - **浏览器端 CORS 直连已实测打通**：经 `curl` 与本地 Playwright + Obscura 真实浏览器（从 `http://127.0.0.1:8787/` 页面上下文发起 `fetch(..., { mode: "cors", credentials: "omit" })`）实测，`www.xiaoyuzhoufm.com` 对任意 `Origin` 动态回显 `access-control-allow-origin: <Origin>`（且简单 `GET` 请求无 `OPTIONS` 预检、无 `CF-Worker` 头），直接返回 **`HTTP 200 OK`** 与完整 `__NEXT_DATA__`（频道 15 集、单集 `enclosure.url`、`shownotes`、21 条热评）。
> - **落地策略**：
>   1. **主通道**：前端在用户浏览器直接 `fetch("https://www.xiaoyuzhoufm.com/podcast/:pid")` 与 `/episode/:eid`，交由共享纯函数模块 `public/js/xyzParser.js` 提取解析。
>   2. **兜底通道**：Worker 后端保留 `/api/xiaoyuzhou/podcast/:pid` 与 `/episode/:eid`（支持配置可选 `XYZ_RELAY_URL` / `XYZ_RELAY_TOKEN` 环境变量，或在非 CF 运行时直接请求）。
>   3. **音频 CDN (`media.xyzcdn.net`)**：不受 `cf-worker` 头影响，支持 `Accept-Ranges: bytes`，`<audio src="https://media.xyzcdn.net/...">` 可直接流式播放并拖动进度条（仅提供在线收听，不提供文件下载）。
  - `User-Agent`: 现代浏览器 UA（如 Chrome 桌面/移动 UA）
  - `Referer`: `https://www.xiaoyuzhoufm.com/`
  - `Accept`: `text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`
  - `Accept-Language`: `zh-CN,zh;q=0.9`
- 小宇宙使用 Next.js SSR，HTML 内包含 `<script id="__NEXT_DATA__" type="application/json">...</script>`。
- **播客频道页 (`https://www.xiaoyuzhoufm.com/podcast/:pid`)**：
  - 数据路径：`props.pageProps.podcast`
  - 核心字段：`pid`, `title`, `author`, `brief`, `description`, `subscriptionCount`, `episodeCount`, `image` (`picUrl` / `thumbnailUrl`), `podcasters`, `contacts`, `payType`, `episodes[]`。
  - `episodes[]` 每项已包含：`eid`, `pid`, `title`, `duration` *(**注意：单位为秒！与 xyzrank 的分钟不同**)*, `pubDate`, `playCount`, `commentCount`, `clapCount`, `description`, `image`, `enclosure.url`（可直接播放或入队！）。
  - **已核实限制**：未登录网页端 `podcast.episodes` **仅返回最新 15 集**，且 JS chunk 无公开分页加载接口。前端必须展示清晰提示，引导前往小宇宙 App 查看全集。
- **单集播放页 (`https://www.xiaoyuzhoufm.com/episode/:eid`)**：
  - 单集路径：`props.pageProps.episode`
    - 字段：`eid`, `pid`, `title`, `duration` *(**秒**)*, `pubDate`, `playCount`, `clapCount`, `commentCount`, `favoriteCount`, `enclosure.url`（真实音频直链，多为 `https://media.xyzcdn.net/...`）, `media` (`size`, `mimeType`), `image`, `shownotes` *(富文本 HTML)*, `payType`, `podcast` (`pid`, `title`, `author`, `image`, `subscriptionCount`)。
    - 特别注意：需透传 `episode.podcast.pid`，使从首页单集榜点进来的用户可一键跳转到所属播客频道页 `/podcast/:pid`！
    - 若 `payType` 非免费（如 `PAY_EPISODE` / `PAY_PODCAST`），需在 UI 标注提示（可能仅提供试听音频）。
  - 评论路径：`props.pageProps.comments`
    - 约 **20~21 条热评**（本轮抽查8集：21条样本均为1条置顶+20条普通；20条也可能已包含置顶。条数取决于上游原始列表，不固定截断；二级回复不计入父评论条数），含 `id`, `pinned`, `text`, `likeCount`, `createdAt`, `ipLoc`, `badges`, `author` (`nickname`, `avatar.picture.smallPicUrl/thumbnailUrl`), `replies[]`（二级回复）。
    - **已核实限制**：未登录网页端无评论分页 API，前端需展示提示「当前展示热门精选评论，查看更多请前往小宇宙 App」。
- **音频 CDN (`media.xyzcdn.net`) 特性（已实测）**：
  - 支持 `Accept-Ranges: bytes`，`<audio src="https://media.xyzcdn.net/...">` 可直接播放并拖动进度条。
  - 前端 HTML `<head>` 设置 `<meta name="referrer" content="no-referrer">`，避免第三方图片/音频后续收紧防盗链。

---

## 4. 数据库与 Free Plan 分批接力同步设计

### 4.1 为什么采用 D1 + 分批接力状态机
- 全量 4 个榜单共约 9,132 条（~93 页 `limit=100` 请求）。
- Cloudflare Workers **Free Plan** 每次触发上限为 **50 次外部 `fetch()` subrequest**、**10ms CPU 时间**（注：D1 查询不计入 50 次外部 `fetch` 限额）。
- 单次 Cron 无法拉完 93 页，因此采用 **时间窗高频脉冲 + D1 状态机接力**：
  - `wrangler.toml` 配置 `crons = ["0-30/2 0,2,10 * * *"]`：北京时间 `08:00–08:30` 每 2 分钟触发一次，推进当天的 `YYYYMMDDT00` 同步；`10:00–10:30` 和 `18:00–18:30` 再各开一个同样的窗口，这一轮没完成就接着跑，已完成则每次触发读 1 次后返回。
  - 全天只有这一轮：`runId` 由日期和 `08:00` 时段生成，全天的触发和管理接口的非强制调用都推进它，`force` 才另起一轮。
  - 每次 `scheduled()` 最多拉取 **15 页**，为重试预留外部请求额度。Free Plan 每次触发另有 10 ms CPU 时间，兜底窗口沿用同样的 15 页，不加大批量。
  - **D1 查询预算**：Free Plan 每次 Worker 调用还最多 50 次 D1 查询，一次 `db.batch()` 只算 1 次。状态机每页只花 1 次：该页的榜单行、`board_meta` 和新的游标在同一个 `db.batch` 里提交。满载的一次调用是 2 次启动 + 15 页 + 1 次读回结果 = 18 次，完成整轮的那次再加 2 次切换；`maxPages` 取上限 35 时是 38 次。改动同步逻辑后用 `test/sync.test.js` 里的查询计数断言核对。
  - **逐页保存与并发保护**：游标随每页落库，某一页失败时之前的页不重抓。加锁是一条带条件的 `UPDATE`（`locked_until <= now`），每页的批次顺带把锁续到 90 秒后，批次结束即释放。游标更新带 `pages_fetched` 比对：锁过期后被别的调用接管的旧调用，在下一页写入时发现比对不上就立即退出，不会把游标写回去，也不能记录失败或发布版本。
  - **失败处理**：`retry_count` 是连续没有存下任何页面的失败次数，没有不可恢复的状态。存下过页面的调用失败只记 `last_error`，下一次触发就重试；一页都没存下的失败把 `status` 记为 `failed`，并用 `locked_until` 让之后的触发等待 2、4、8、最多 16 分钟再试，所以上游故障时半小时窗口内请求 5 次而不是 16 次。存下任意一页就清零，等待结束后的触发会接着跑。
  - **告警与日志**：兜底窗口里一次失败的尝试会调用 `onAlert`（`index.js` 接到 `sendAlert`，向可选的 `ALERT_WEBHOOK_URL` 发通知），上午窗口不发，同一轮 4 小时内最多一条，发送成功后记在 `app_state` 的 `sync_alert:<runId>`。没有 `ALERT_WEBHOOK_URL` 时不发任何东西。每次定时触发在 Workers Logs 里留一行结果（`wrangler.toml` 已开启 `[observability]`）。
  - 拉取顺序优先小榜单后大榜单：`episodes` (8 页) -> `new-episodes` (1 页) -> `new-podcasts` (2 页) -> `podcasts` (82 页)。
  - 约 7 次触发（约 12 分钟）完成全部 93 页并将 `sync_runs.status` 置为 `completed`。窗口内剩余的触发查到已完成后直接返回，外部请求数为 0。整个 `08:00` 窗口没跑成时，`10:00` 窗口同样 7 次触发补完。
  - 目前约 9,100 条的规模，每天一轮约消耗 35.8k 行写入。D1 免费写入额度为账户共享的 100k/UTC 日，手动同步和迁移也计入额度。

### 4.2 原子版本切换（读写隔离）
- 每次同步生成唯一 `sync_version`（如 `20261117T00`）。
- 新拉取数据带 `sync_version` 写入 `episodes_rank` / `podcasts_rank` / `board_meta`。
- 前端 API 读取 `app_state.active_sync_version` 对应的完整版本；仅当整轮 4 个榜单全部抓取完成后才切换：把这一轮标记为 `completed`、写入 `prev_sync_version` / `active_sync_version` / 分类缓存、清理更早的版本，全部在同一个 `db.batch` 里提交，每条语句都以该行为 `completed` 为条件。保留最近 1~2 个版本供趋势对比。
- **不发布残缺版本**：榜单中途返回空页按失败处理，不当作该榜结束；新一轮声明的总条目数不到当前版本一半时拒绝发布并记入 `last_error`，当前版本和它的上一版保持不变。
- **冷启动兜底**：若 `active_sync_version` 尚未存在（首次部署刚启动第 1 批），允许回退读取最近一条 `sync_runs` 的已入库数据，保证首次部署几分钟内即有数据可看。

### 4.3 D1 表结构要点 (`migrations/`)
- `episodes_rank` 使用 `WITHOUT ROWID` 联合主键 `(sync_version, board, eid)` 和排名索引 `(sync_version, board, rank)`。分类过滤在路径指定的小榜单内扫描。
- `podcasts_rank` 使用 `WITHOUT ROWID` 联合主键 `(sync_version, board, raw_id)`，配排名索引 `(sync_version, board, rank)` 和分类索引 `(sync_version, board, primary_genre)`。
- `0002_rank_composite_keys.sql` 在迁移中复制已有榜单数据并换表，保留各版本和对应的趋势基线。升级已有库前按快照体量预留一次性写入额度，部署窗口参见 README。
- `board_meta`: `(sync_version, board, total, synced_count, median_values_json, updated_at, PRIMARY KEY (sync_version, board))`。已发布版本的 `total` 同时作为无筛选榜单请求返回的总数。
- **读取额度**：Free Plan 每天读 500 万行，超出后 D1 报错到次日 08:00（北京时间）。`COUNT(*)` 与非排名列排序都会扫完整个榜单分区（热门播客约 8,200 行/次），新增查询前先用 `test/helpers/sqliteD1.js` 或本地 `meta.rows_read` 估算读取量。
- `sync_runs`: `(run_id PK, slot, status, current_board, current_offset, pages_fetched, items_written, retry_count, last_error, locked_until, started_at, finished_at)`。`pages_fetched` 同时是游标更新的比对值；`locked_until` 是锁的到期时间（毫秒，`0` 表示未加锁），失败后也是下一次允许重试的时间；`status` 为 `failed` 只表示最近一次尝试失败。
- `app_state`: `(key PK, value, updated_at)`。

---

## 5. 后端 API 规范

| 方法与路径 | 鉴权 | 说明 |
|---|---|---|
| `GET /api/health` | 无 | 健康检查与 D1 连通性检测；`sync` 返回已发布版本、最后更新时间、数据年龄 `ageHours` 和 `stale`（超过 25 小时，或首次同步开始超过 25 小时仍未发布），供外部监控告警 |
| `GET /api/boards/meta` | 无 | 返回当前 `active_sync_version` 及 4 榜单总数、更新时间、分类列表 |
| `GET /api/boards/:board` | 无 | 分页查询榜单；参数 `offset` (0), `limit` (<=100), `q`, `genre`, `sort` (白名单映射 SQL 列), `dir` (`asc`\|`desc`)。`total` 始终为数字：已发布版本的无筛选请求取 `board_meta.total`，带 `q`/`genre` 时执行一次 `COUNT(*)` 并按版本缓存在 isolate 内存；冷启动的未发布版本每次都计数 |
| `GET /api/xiaoyuzhou/podcast/:pid` | 无 | 实时抓小宇宙播客页并解析返回 `{ podcast, episodes, limited: true, sourceUrl }` |
| `GET /api/xiaoyuzhou/episode/:eid` | 无 | 实时抓小宇宙单集页并解析返回 `{ episode, comments, limited: true, sourceUrl }` |
| `POST /api/admin/sync` | `X-Admin-Key` | 推进当天这一轮同步，请求体 `{ maxPages?: number, force?: boolean, runId?: string }`：`maxPages` 默认 15、最多 35；`force` 另起一轮（编号带 `-m<时间戳>`）。冷启动/调试用 |
| `GET /api/admin/sync/status` | `X-Admin-Key` | 查看 `sync_runs` 与 `active_sync_version` |

> **安全边界**：
> - `pid` / `eid` 必须做正则校验（如 `/^[a-zA-Z0-9]{16,36}$/`），禁止构造任意路径/SSRF。
> - `/api/boards/:board` 的 `sort` 字段必须使用**显式白名单字典**映射到 SQL 列名，严禁字符串拼接用户输入。
> - `ADMIN_KEY` 通过 `.dev.vars`（本地）和 `wrangler secret put ADMIN_KEY`（线上）配置，绝不硬编码或提交 git。

---

## 6. 前端交互与播放器规范

### 6.1 路由与页面
1. **首页 4 榜单 (`/`, `/hot-podcasts`, `/hot-episodes-new`, `/new-podcasts`)**
   - 顶部固定导航（`position: fixed` + `--header-h` 动态内边距）：Logo（点击打开项目介绍与 GitHub 链接）、全局搜索框（380ms 防抖；手机由搜索按钮展开）、4 榜单 Tab 切换、播放列表按钮、主题切换与桌面同步时间。详情页仅保留精简品牌/操作栏。微信内通过 `index.html` 头部内联脚本提前恢复默认文字缩放，监听桥接就绪/字号菜单/页面恢复；微信作用域下html/body固定text-size-adjust为100%，普通浏览器不启用。项目介绍弹窗使用局部触摸边界拦截：遮罩、无溢出内容及上下边界阻止默认滚动，溢出内容允许在弹窗内滚动，避免背景列表穿透。
   - **虚拟滚动 (`RankBoard.js` + `computeVirtualWindow`)**：移动端 `.rank-cards` 与 PC 端 `.rank-table` `<tbody>` 均仅渲染可视窗口及前后缓冲区条目，动态测量并缓存实测行高，通过上下 spacer 保持总文档高度，避免长列表 DOM 膨胀。
   - **移动端 (`< 768px`)**：卡片流布局（排名与升降/新上榜标识、正方形封面、主标题、可点击进频道的播客名/主播、分类与已听进度标签；单集卡片附「▶ 播放」「+ 队列」按钮）。
   - **PC 端 (`>= 768px`)**：自适应高信息密度表格（支持列头排序、中位数提示、排名趋势、单集直跳频道与已听进度），保留快捷播放/入队与进内页交互。
   - 四榜Tab点击及横滑均使用router.replace，共用当前历史位置，不累积后退步骤；进入详情使用push，返回恢复最后榜单及其滚动位置（外链冷启动直达内页时返回自动回退至 `/` 热榜首页，且详情页顶栏常驻「热榜」入口，未匹配路径走 404 兜底页）。手机列表支持左右滑动切换相邻榜单Tab（左滑下一个，右滑上一个，首尾不循环）；仅<768px启用，排除控件、屏幕24px边缘、弹层、多指及取消手势，纵向起手不切换；方向锁12px、横移64px且大于纵移1.5倍、700ms内完成，横滑后抑制误点击。
   - 触底 `IntersectionObserver` 自动加载下一页（或手动"加载更多"兜底）。
   - **数据未更新提示**：当前版本的最后更新时间超过 25 小时（`public/js/freshness.js` 的 `isBoardDataStale`，与 `/api/health` 共用）时，四个榜单顶部显示「榜单数据还停留在 M 月 D 日 HH:mm，今天的同步还没有完成，系统会自动重试。」，桌面端顶栏的更新时间变为警示色。根组件每 5 分钟核对一次，页面一直开着也会出现；数据正常时不显示任何内容。
2. **播客频道页 (`/podcast/:pid`)**
   - 展示频道封面、标题、主播、简介（可展开）、订阅/总集数、"去小宇宙官网"外链。
   - 最新 15 集列表：整卡点击或键盘 Enter/空格进入详情，独立提供「▶ 播放」「+ 加入播放列表」按钮；手机日期/时长/播放/评论独占一行，操作另行排列，以及「将本页 15 集全部加入播放列表」快捷操作；显示网页端 15 集限制提示。
3. **单集播放页 (`/episode/:eid`)**
   - 展示单集封面、标题、可点击跳转到 `/podcast/:pid` 的所属播客链接、发布时间、时长、数据指标、付费/试听提示（如适用）、"去小宇宙官网"外链。
   - 操作区：「▶ 播放 / ⏸ 暂停 / 继续播放」「+ 加入播放列表」。单集已在列表中且可以移到当前单集之后时，提供「下一首播放」。
   - **Shownotes**：经 `DOMPurify.sanitize()` 净化渲染，长简介默认仅展示240px预览，底部叠加88px背景渐变遮罩（不依赖CSS mask），展开/收起文案采用主题强调色，点击展开全文/再次收起；短简介完整展示，无折叠按钮。基于ResizeObserver跟随图片及响应式内容高度变化；折叠时正文不可聚焦，避免Tab进入隐藏链接。识别文内 `HH:MM:SS` / `MM:SS` 时间戳转为可点击高亮按钮，点击即自动加载当前单集并跳转到对应秒数播放。
   - **热评区**：渲染置顶/热评列表、IP 属地、徽章、点赞数及二级回复，并展示约 20 条热评限制提示。评论正文与二级回复均通过纯文本切分（`parseTextWithTimestamps`，按单集时长过滤无效时钟时间，不经 `v-html`）支持点击时间戳直接空降跳播。二级回复1～2条完整展示，不加遮罩或展开按钮；至少3条时才默认折叠并提供展开/收起。

### 6.2 全局播放器与 `localStorage` 持久化
- 根组件维护单一 `<audio>` 实例与 `playerState`（保证切换页面时音频持续播放；音频加载报错时自动强制重抓一次单集详情刷新 `enclosureUrl` 重试）。
- 项目介绍、全屏播放器与队列通过 `overlayHistory.js` 使用Vue Router同URL历史状态：物理/浏览器返回优先关闭顶层弹层；手动收起/关闭消耗对应历史记录；播放器内跳转先清理弹层历史，再进入内页，音频与底层滚动保持。
- **核心播控**：
  - 播放/暂停、进度条拖动（实时预览目标时间，松手 `seek`）。
  - **后退 15 秒 (`-15s`)**、**前进 30 秒 (`+30s`)**。
  - **倍速切换**：`0.9x`、`1x`、`1.1x`、`1.2x`、`1.3x`、`1.5x`、`1.75x`、`2x`。宽度小于 480px 时每行四档，宽屏单行展示，选中后焦点回到倍速按钮。读取不支持的本地档位时使用 `1x`，导入备份中的无效档位时保留当前设置。
  - **循环模式三态**：`sequential`（顺序播完列表后停）、`repeat-one`（单曲循环）、`repeat-all`（列表循环）。
  - **睡眠定时 (`sleepMode`)**：支持 `15/30/45/60 分钟` 倒计时（结束前 3 秒渐弱淡出音量）与 `播完本集自动停`。
  - 集成浏览器 `navigator.mediaSession` API（锁屏封面、标题、快进/快退/上下曲控制，以及 `setPositionState` 实时同步倍速与播放进度）。
  - **桌面端全局快捷键 (`onGlobalKeydown` + `shouldIgnoreGlobalHotkey`)**：焦点不在输入框/下拉框/可编辑区（以及 `Space` 不在可点击按钮/链接上）且无修饰键/输入法组合时，支持 `Space` 播放/暂停、`←` / `→` 后退 15s / 前进 30s、`[` / `]` 步进倍速、`M` 静音切换、`/` 聚焦榜单搜索框。
- **本地「我的收听」中心 (`LibraryDrawer`)**：
  - 免登录本地关注播客（`xyzp_v1_favorites`，上限 300 个）：支持在播客榜、频道页、单集页一键关注/取消关注，单集榜与播客榜同步高亮 `已关注` 标签。
  - 「关注播客」Tab 的「手动添加」接受 PID 或小宇宙频道链接，忽略查询参数及片段。前端重新请求频道详情，核对频道后按 PID 去重保存，也支持榜单未收录的频道。
  - 富元数据收听历史：复用 `xyzp_v1_progress` 附带保存 `{ title, podcastName, pid, image, enclosureUrl }`，支持按最近收听时间浏览、一键续播/重播、单条删除与清空历史（均含 5 秒撤销）。
  - 数据迁移与开放订阅：支持导出完整收听备份 JSON、从 JSON 智能合并恢复（按更新时间戳保留最新收听进度）、以及导出标准 **OPML 2.0** 订阅文件（自动提取 `xyzrank` 附带的 RSS `xmlUrl` 与小宇宙 `htmlUrl`）。
- **播放列表 (`PlaylistDrawer`)**：
  - 榜单、频道和单集页直接播放另一集时，将其放到列表第一位并开始播放；已在列表中的单集移到队首。单集入队时插到当前单集之后，保留当前播放或暂停状态；空队列入队后等待用户播放，重复入队只提示已在列表中。
  - 支持增删、下一首播放插队、清除已播完单集、一键清空、**SortableJS 拖拽排序**（配拖拽手柄避免与移动端页面滚动冲突），调序菜单提供下一首/上移/下移/置顶按钮；单条移除、清除已播完与清空队列均支持5秒撤销。手机按内容自适应高度并限制80dvh，桌面为440px侧栏。
- **进度保存与恢复 (`localStorage`)**：
  - Key 命名规范（建议前缀 `xyzp_v1_`）：
    - `xyzp_v1_queue`：当前播放列表及 `currentEid`
    - `xyzp_v1_progress`：以 `eid` 为键的进度映射 `{ [eid]: { currentTime, duration, finished, updatedAt, title?, podcastName?, pid?, image?, enclosureUrl? } }`（上限保留最近 200 条按 `updatedAt` 淘汰）
    - `xyzp_v1_prefs`：`{ playbackRate, loopMode, theme }`
    - `xyzp_v1_favorites`：本地关注的播客列表 `[{ pid, title, author, image, rssUrl, xyzUrl, addedAt }]`
  - 每播放 3~5 秒、暂停、`seeked`、切集、`pagehide`/`beforeunload` 时持久化；下次加载同一 `eid` 时若 `currentTime > 5` 且未 `finished`（剩余 > 5s）自动定位续播，并给予轻提示（如"已恢复至 12:34"）。
  - **已播完标记不得被覆盖**：`onAudioEnded` 存入 `finished: true` 后，连播切到下一集、移除当前单集以及 `pagehide`/`beforeunload` 都会再次调用 `flushProgressNow()`；它依据 `audio.ended` 决定 `finished`，已播到结尾时保持 `true`。回归测试见 `test/player.test.js`。
  - **移除当前单集**：切到下一集并保持原有播放状态。播放器处于暂停时只加载下一集（`playTrack(track, { autoplay: false })`），不自动开始播放，迷你栏显示播放按钮而不是加载动画。

---

## 7. 常用命令与验证方式

生产部署推荐参考README的Fork+Cloudflare Workers Builds控制台流程；部署命令为 `npm run db:migrate:remote && npm run deploy`，构建命令留空。`npm run deploy` 会先经 npm 的 `predeploy` 钩子执行 `npm run check`（ESLint 与全部测试），不通过则不发布；`.github/workflows/ci.yml` 在推送到 `main` 和 PR 时运行同一检查。Workers Builds 不读取 `wrangler.toml` 里的自定义构建命令，门禁依赖部署命令保持为 `npm run deploy`。Fork用户先创建自己的D1并修改database_id，构建令牌需包含D1编辑权限；已有Worker可在设置→Builds连接仓库，保持Worker名称与数据库配置一致。下方命令主要供本地开发和可选CLI部署使用。

> 随着项目推进，以下脚本需在 `package.json` 中落地并保持文档同步。

```bash
# 安装依赖
npm install

# 初始化/应用本地 D1 迁移
npx wrangler d1 migrations apply xyz-podcast-db --local

# 本地启动开发服务器（默认读取 .dev.vars）
npm run dev                  # 等价于 npx wrangler dev

# 本地模拟触发 Cron 定时任务（验证分批接力同步）
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0-30/2+0,2,10+*+*+*"

# 运行单元测试（Parser、工具函数、Sync 状态机、榜单接口、播放器、冒烟）
npm test                     # node --test；需要 Node >= 22.13（node:sqlite）

# 代码规范检查（ESLint 推荐规则，提交前必须通过）
npm run lint                 # eslint .

# 提交前与部署前的完整门禁（npm run deploy 经 predeploy 钩子自动执行）
npm run check                # npm run lint && npm test

# 部署到 Cloudflare（先应用远程 D1 migration）
npx wrangler d1 migrations apply xyz-podcast-db --remote
npm run deploy               # npx wrangler deploy
```

---

## 8. 多 Agent 交接协议（必读）

### 8.1 接手工作流（每次开工前）
1. 阅读 `AGENTS.md` 与 `CHECKLIST.md`，定位当前状态为 `[/]`（未完待续）或下一个 `[ ]`（待办）的任务。
2. 检查工作区现状（`git status`、`git log -n 5`、`ls -la src public migrations`），确认文档与实际代码一致。
3. 一次聚焦一个清晰的任务或里程碑；开始前将对应条目在 `CHECKLIST.md` 中标记为 `[/]`。

### 8.2 完成工作流（每次停笔/提交前）
1. 运行与本次改动匹配的验证：先执行 `npm run check`（ESLint 与全部测试，任何一项未通过都不得提交），再做与改动匹配的本地 `wrangler dev` 实测或真实浏览器检查，**严禁未验证即标记完成**。
2. 更新 `CHECKLIST.md`：将完成项改为 `[x]`，并简要写明**验证方式与实测结果**（或阻塞原因 `[!]`）。
3. 更新本文档第 9 节 **"当前进度与交接快照"**（以及如有结构/接口变更同步更新第 2~7 节）。
4. 按 `CLAUDE.md` 规范做原子化 git commit（Conventional Commits：`feat:` / `fix:` / `docs:` / `test:` / `chore:`）。

---

## 9. 当前进度与交接快照

- **最后更新**：2026-11-23
- **榜单封面回退**：`FIX-03` 合并重复的 `@small` 后缀。用户示例的单后缀代理地址返回 404，编码路径中的 HTTPS 原图返回 200。Chromium、WebKit 验证缩略图优先及原图和占位图回退，`npm run check` 通过，单测 53/53。
- **部署前门禁**：`CI-01` 新增 ESLint 10（`npm run lint`）、模块冒烟测试 `test/smoke.test.js`（逐个模块 `node --check`、按 `import` 语句核对导出、用与页面同版本的 `@vue/compiler-dom` 编译全部模板）、GitHub Actions 工作流，以及 `predeploy` 钩子（`npm run deploy` 前自动执行 `npm run check`，不通过则不发布）。推荐规则报出的 3 处重新抛错已保留 `cause`，兜底流程由 `test/api.test.js` 覆盖。`npm run check` 在 Node 24 与 Node 26 下通过，`npm test` 51/51。资源版本 `app.js?v=43`、`sw.js v17`。
- **已播完标记**：`FIX-01` 修复连播切集、关闭页面时把刚播完的单集覆盖成未播完的问题（`flushProgressNow` 改为依据 `audio.ended` 保留 `finished`）。`test/player.test.js` 驱动根组件真实方法，Chromium、WebKit 各 12 项真实音频播放检查通过（未修复时失败）。
- **暂停时移除当前单集**：`FIX-02` 修复移除当前单集后下一集自动开始播放的问题，暂停状态下只加载不播放，播放中则照常接续。同一套浏览器检查在 Chromium、WebKit 各 12 项通过，资源版本 `app.js?v=42`、`sw.js v16`。
- **榜单读取额度**：`PERF-05` 去掉已发布版本无筛选请求的 `COUNT(*)`，改读同一请求里已有的 `board_meta.total`；带筛选的计数按版本缓存在 isolate 内存。响应格式不变。本地 workerd 实测热门播客首页 8,277 → 86 行、第 6 页 8,677 → 486 行、热门单集首页 918 → 126 行；非排名列排序仍需全表扫描（热门播客约 16,400 行/次），待后续处理。新增 `test/boards.test.js` 对真实 SQLite 验证 8 项，`npm test` 36/36。
- **同步查询预算**：`SYNC-01` 同步状态机改为每页一次 `db.batch`（榜单行 + `board_meta` + 游标和锁），加锁与版本切换各合并成一条查询。93 页时每次调用 18 条查询（原 48~49），最后一批为满载时 19~20 条（原 51~54），`maxPages` 上限 35 时 38 条，Free Plan 上限为 50。游标逐页落库，加锁原子化，被接管的旧调用不会再覆盖游标或发布版本。本地 workerd 空库实测 7 次调用同步发布 94 页，线上未验证。
- **同步失败退避**：`SYNC-02` 失败次数改为连续无进展的计数，存下一页即清零，不再把当天永久标记为失败；无进展的失败按 2/4/8/16 分钟退避。榜单中途空页按失败处理，新一轮条目数不到当前版本一半时拒绝发布。单测覆盖，线上未验证。
- **同步兜底窗口**：`SYNC-03` 全天的触发共用同一轮（`computeDailyRunKey`），Cron 改为 `0-30/2 0,2,10 * * *`，北京时间 10:00 和 18:00 各再开半小时窗口接着跑，已完成时每次触发 1 次查询。仍用 15 页一批（Free Plan 每次 Cron 触发 10 ms CPU）。抓完但发布失败的尝试也按失败计。单测覆盖，线上未验证。
- **数据未更新提示**：`SYNC-05` 当前版本的最后更新时间超过 25 小时时，四个榜单顶部显示提示，桌面端顶栏的更新时间变为警示色，页面每 5 分钟核对一次。`/api/health` 的 `sync` 增加 `version`、`updatedAt`、`ageHours`、`stale`，首次同步开始超过 25 小时仍未发布也算过期。浏览器检查发现并修复了数据正常时也显示提示的问题（`new Date(null)` 是 1970 年）并补了单测。Chromium、WebKit 在 390px、1280px 浅深色共 48 项通过，单测 81/81；资源版本 `app.js?v=45`、`app.css?v=36`、`sw.js v19`。
- **同步告警**：`SYNC-04` 兜底窗口里的尝试失败时向可选的 `ALERT_WEBHOOK_URL` 发通知（普通地址 POST JSON `{ text }`，含 `{text}` 的地址替换后 GET），上午窗口不发，同一轮 4 小时内最多一条，投递失败不算已发。`wrangler.toml` 开启 Workers Logs，每次定时触发记录一行结果。
- **手动关注播客**：`UI-27` 在「关注播客」Tab 增加手动添加入口，接受 PID 和频道链接，验证后按 PID 去重保存。Chromium、WebKit 验证原生输入框、有效及无效输入、重复添加和刷新恢复，单测 28/28。
- **小宇宙图片缩略图**：`PERF-04` 在浏览器设置封面、头像及简介插图的 `src` 前转换到 `@small`，覆盖已有本地收藏、历史及队列。真实 CDN 样本及 Chromium、WebKit 请求验证通过，单测 26/26。
- **单集播放与入队顺序**：`UI-26` 在榜单、频道和单集页立即播放另一集时移到队首，单集入队时插在当前单集之后。Chromium 实测卡片和表格、频道和单集页的操作，以及重复入队、空队列、调序、顺序续播及刷新恢复。单测 25/25。
- **移动端顶栏间距**：`UI-25` 右上角按钮间隔 8px，360px 以下为 6px，标题随可用空间省略。Chromium 与 WebKit 验证首页和详情顶栏、三位数计数及四个按钮的触摸操作，单测 25/25。
- **D1 每日同步与索引**：`P2-06` 改为北京时间 08:00 一轮，榜单表使用 `WITHOUT ROWID` 联合主键，保留两个排名索引和播客分类索引。11 月 20 日 09:02 生产迁移与部署成功，线上仅有 `*/2 0 * * *`。当日手动补跑于 09:12 完整发布 `20261120T00`，D1 账户写入较迁移后增加 35,781 行。首轮自动同步预计 11 月 21 日 08:00 启动，执行结果待观测。
- **D1 免费额度诊断**：`P2-05` 核实 11 月 18 日早晚与 19 日晨间榜单正常发布，旧结构稳态两轮同步计约 109.6k 写入/UTC 日，超过账户每日限额。
- **倍速兼容清理**：`UI-24` 移除退役档位的专用映射，读取设置和导入备份都按现有档位校验。单测 25/25。
- **播放器倍速**：`UI-23` 新增 0.9x、1.1x、1.2x、1.3x 档位，兼容旧设置与备份。Chromium 实测 320/390/479px 为四列两行、480/1280px 为八列一行，各按钮至少 44×44px。选档、键盘步进、刷新及睡眠定时验证通过，单测 25/25。
- **本轮设计审查**：2026-11-17 环境限制解除后，已通过 Browser MCP 与 Playwright 完成四榜、频道/单集、播放器/队列、评论和深色频道的手机/桌面/短屏视觉走查。建议见 `DESIGN_REVIEW.md`，截图在 `/tmp/xyz-review/`；仅更新审查文档，未修改产品代码或部署，P7-05/P7-06 状态保持。
- **本轮设计实施**：`UI-02` 已完成并验证：手机精简导航/搜索展开/稳定筛选、迷你栏、队列自适应与撤销/调序、深色主题、详情阅读与桌面头部、骨架/封面兜底、主要动效与键盘焦点管理。`npm test` 18/18；320/375/390px手机及1280px桌面实测通过，页面错误0。截图 `/tmp/xyz-ui02/`；本轮未部署。
- **最新视觉修正**：`UI-03` 按用户反馈移除榜单当前条目彩色左线；播放/加队列按钮高度改28px、间距12px，加号和勾选无圆框及底色。Playwright播放/暂停、浅深色和320/390/1280px验证通过，页面错误0；未部署。
- **最新焦点修正**：`UI-04` 已移除橘红色outline及搜索聚焦光晕；触摸按钮无描边，键盘Tab保留1px中性灰焦点。Playwright触摸/键盘与浅深色搜索验证通过，未部署。
- **最新对齐修正**：`UI-05` 将手机榜单卡片底部数据行右缩进28px，与封面左边缘对齐；320/390px四榜坐标及溢出检查通过，未部署。
- **最新搜索修正**：`UI-06` 已隐藏浏览器原生搜索清空图标，保留单个自定义清空按钮；390/1280px输入/清空与手机截图验证通过，未部署。
- **最新频道修正**：`UI-07` 删除最新15集卡片中的详情按钮，整卡支持点击/键盘进入详情；手机四项数据单行、播放与队列另行显示。320/390/1280px的15条数据行和导航/按钮隔离验证通过，页面错误0；未部署。
- **最新频道对齐**：`UI-08` 频道单集底部右缩进64px，四项数据与描述文字左边缘对齐；320/390/1280px下15条单行、对齐与无溢出验证通过，未部署。
- **最新频道间距**：`UI-09` 去掉数据行顶部叠加padding，数据行与描述、按钮之间均为8px；320/390px全部15条坐标实测通过，保持左对齐，桌面无溢出；未部署。
- **最新滚动修正**：`UI-10` 根页面及播放器/队列滚动区已设置 `overscroll-behavior-y: none`；Chromium快速触摸滑动180帧固定播放栏bottom均为844px，正常滚动与计算样式验证通过。实体iPhone/Safari原生回弹尚待核对；未部署。
- **最新品牌与同步检查**：`UI-11` 顶栏名称改为「小宇宙播客热榜」，本地浏览器验证通过，README补充成功判定方式。北京时间2026-11-17 20:10只读核实线上 `20261117T12` 仍running（75页/7341条，热门播客6400/8191），无重试/错误，尚未完整发布；未手动触发同步，未部署名称修改。默认每批15页，93页通常需7次Cron触发、约12分钟。
- **最新Shownotes提示**：`UI-12` 仅在渲染后的Shownotes确有时间戳跳转按钮时显示提示；六组浏览器用例验证通过，页面错误0，未部署。
- **最新评论核查**：`DATA-01` 抽查8个官网单集原始列表并与项目解析器比较：3例21条（1置顶+20普通）、3例20条无置顶、2例20条含1置顶；原始/解析条数一致，ID无重复，未发现项目计数bug。证据 `/tmp/xyz-comments/results.json`；上游置顶合并算法未公开，不假定有置顶必定21条，未修改产品代码。
- **最新请求头核查**：`DATA-02` 已核对Worker两类上游请求的UA/Referer/Accept等现有配置及浏览器cors/omit/no-referrer。对照MDN与Cloudflare官方资料确认浏览器伪造头限制及CF-Worker平台标记；不建议为未知未来拦截堆叠标头，保留现状并按实际失败原因调整，未修改产品代码。
- **最新路由过渡**：`UI-13` 离场钩子同步移除旧页，避免路由滚动归零时旧列表还在淡出；入场改为120ms透明度淡入并移除上移。390/1280px帧采样旧列表顶部可见帧从7降为0；榜单/频道进入与后退滚动恢复、减少动态效果通过，单测18/18；未部署。
- **最新返回键修正**：`UI-14` 全屏播放器/队列已接入同URL历史；物理返回先关闭顶层弹层，再后退页面，手动关闭不留空后退步骤，播放器内导航先清理弹层历史。手机/桌面嵌套/前进/刷新/连续返回/直接进入/末集撤销测试通过，音频和滚动保留，页面错误0，单测18/18；未部署。
- **最新项目介绍**：`UI-15` Header Logo 改为项目介绍入口，弹窗包含项目用途、收听功能、数据来源及 GitHub `icheer/xyz-podcast`。接入同URL弹层历史，支持返回/前进、关闭按钮、遮罩、Esc及焦点管理；320/390/1280px浅深色、滚动保留验证通过，页面错误0，单测18/18；未部署。
- **最新简介折叠**：`UI-16` 对照官网为长Shownotes增加240px默认预览、64px渐隐及展开/收起，短内容无需展开；重新加载单集默认收起，收起长文时回到简介区。320/390/1280px浅深色、键盘、动态高度、重载及六组时间戳提示验证通过；真实节目展开后时间戳播放正常，页面错误0；单测18/18，未部署。
- **最新渐隐修正**：`UI-17` 用户反馈部署后手机渐隐缺失，现以88px背景渐变叠层替代mask-image，展开/收起改为主题强调色与600字重，资源版本v22。Chromium/WebKit 320/390/1280px浅深色及展开/收起、键盘、重载、动态高度验证通过，页面错误0，单测18/18；本次未部署，实体手机待复核。
- **最新弹窗滚动修正**：`UI-18` 项目介绍弹窗新增非passive触摸边界拦截及遮罩overscroll限制，阻止背景穿透并保留短屏内部滚动；不改变页面定位，资源v23。Chromium原生触摸验证390×844/390×480内部及边界/遮罩滑动不改变背景600px滚动位置，关闭后列表可滑动；WebKit同尺寸事件拦截通过，错误0，单测18/18。本次未部署，实体手机待复核。
- **最新微信字号控制**：`UI-19` 新增首屏提前执行的 `wechatFont.js`，仅微信环境设置html/body文字缩放100% important，原生桥接就绪/菜单调整/pageshow恢复默认字号，重复就绪不重复订阅，接口异常安全降级；资源v24。Chromium/WebKit共10组桥接mock通过，Chromium内联180%覆盖为100%，布局保留、错误0、单测18/18。Linux WebKit无该CSS属性实现，微信原生缩放尚待iOS/Android真机复核；未部署。
- **最新回复折叠规则**：`UI-20` 修复只要有回复就出现展开按钮的问题，改为至少3条二级回复才折叠并显示展开/收起；1～2条含长文本完整展示且无渐隐，资源v25。390/1280px 0～3条边界及展开/收起验证通过，错误0，单测18/18；未部署。
- **最新榜单横滑**：`UI-21`（2026-11-18）移动端榜单支持左滑下一个/右滑上一个Tab，首尾不循环，方向阈值和控件/边缘/弹层排除避免误切换，资源v26。Chromium原生320/390px四榜双向、纵滚与600px滚动恢复、卡片点击/音频实例保留及1280px不切换通过；Chromium/WebKit事件边界与后退检查通过，错误0，单测18/18；未部署。
- **最新榜单历史精简**：`UI-22`（2026-11-18）Tab链接增加replace，横滑也改用router.replace；四榜共用当前历史位置，详情仍push。Chromium/WebKit 390/1280px连续切榜不增加history.length/position、详情返回最后榜单和500px原位置、弹窗返回及离开榜单无需逐个回退验证通过，错误0，单测18/18；资源v27，未部署。
- **最新部署文档**：`DOC-01`（2026-11-18）README以Fork+Workers Builds网页部署为主，补充自建D1/自动迁移/令牌权限/已有Worker接Git/运行时密钥/首次Cron及控制台SQL状态查询，CLI方式折叠为可选并移除失效下载API。官方文档核对、配置示例/npm映射/SQLite SQL/Markdown及4个测试文件验证通过；只改文档，未操作线上Worker、数据库或Git关联。当前环境`.git`只读导致提交失败，改动留在工作区。
- **最新 CDN 调整**：`PERF-01` 将入口页 5 个 unpkg 脚本固定为完整版本号。发布记录、文件路径、HTML 和 4 个测试文件检查通过。当前环境无法直接请求 unpkg，HTTP 状态待联网复核。
- **最新脚本加载调整**：`PERF-02` 按实测 Location 固定 Vue Router 4.6.5 和 Lucide 1.74.0。首屏 3 个 CDN 脚本使用 `defer`，DOMPurify 和 SortableJS 按需加载。4 个测试文件及模拟慢加载、失败重试、播放列表关闭后再打开的检查通过。实际 CDN 请求待联网复核。
- **最新首屏请求合并**：`PERF-03` 将微信字号初始化内联到 CSS 之前，按需库加载器合入 `utils.js`。本地 Chromium 冷缓存首页 JS 请求由 18 个降至 16 个。5 个固定 CDN 地址均直接返回 HTTP 200，首页渲染、队列拖拽初始化、详情净化和微信桥接模拟通过。单测 18/18。
- **最新 P0 + P1 全量升级（2026-11-18）**：`FEAT-P0-P1` 已完成代码落盘（零破坏性 D1 表结构变更，100% 兼容线上现有库）：
  - **P0**：① 外链冷启动直达详情页返回自动回退 `/` 热榜首页 + 详情页顶栏增加「热榜」入口 + `/:pathMatch(.*)*` 404 兜底路由；② `sw.js` (`v3`) 仅对 `navigate` 请求回退 `"/"`，避免弱网下 `.js/.css` 被注入 HTML；③ `/api/boards/meta` 分类聚合缓存至 `app_state` (`genres:<version>`) 并为 `/api/boards/*` 启用 `Cache-Control` + 按版本隔离的 Worker `caches.default` 边缘缓存；④ `index.html` 首屏内联防深色闪白（FOUC）与系统深色自适应、`sync.js` 单页抓取 12s `AbortController` 超时、清空遗留 `src/handlers/download.js` 代理逻辑。
  - **P1**：① 热评与二级回复时间戳纯文本切分一键空降跳播（`parseTextWithTimestamps`，按单集时长过滤无效时间，无 `v-html`）；② 全屏播放器新增睡眠定时器（`15/30/45/60分` 倒计时含 3s 音量渐弱 + `播完本集停`）；③ 榜单对比 `prev_sync_version` 展示 `↑ / ↓ / 新(NEW)` 趋势标识、单集榜关联 `podcastPid` 支持一键直跳 `/podcast/:pid`、单集榜透出 `已听 XX% / 已播完` 标签；④ `MediaSession.setPositionState` 锁屏进度同步、队列新增「下一首播放」与「清已播」、清空/清已播/单删统一 5 秒撤销、音频报错自动强制重拉单集详情刷新 `enclosureUrl` 重试。
- **最新 P2 升级（免登录「我的收听」中心 + PC 全局快捷键，2026-11-18）**：`FEAT-P2` 已完成代码落盘（`P3` CSS 整理按用户计划留待验收后单独进行）：
  - **本地「我的收听」中心 (`LibraryDrawer.js` + `storage.js` + `overlayHistory.js`)**：顶栏新增「我的收听」入口并接入同 URL 弹层返回栈；支持在播客榜、频道页、单集页一键关注/取消关注播客并在四榜透出 `已关注` 标识；收听进度同步持久化单集标题/频道/封面/直链以驱动「收听历史」Tab（支持一键续播、单删与清空 5 秒撤销）；底部内置 **导出备份 (JSON)**、**导入恢复 (JSON 智能合并)** 与 **OPML 2.0 订阅导出**（含 RSS `xmlUrl` 提取）。
  - **PC 桌面端全局快捷键 (`app.js` + `utils.js` + `PlayerBar.js` + `AboutDialog.js`)**：新增 `shouldIgnoreGlobalHotkey` 安全守卫（避让输入框、IME 组合、修饰键与聚焦按钮 `Space`），支持 `Space` 播放/暂停、`←`/`→` -15s/+30s、`[`/`]` 倍速步进、`M` 静音切换（含全屏播控页静音按钮与迷你栏状态提示）、`/` 聚焦榜单搜索框，并在项目介绍弹窗及播控按钮 `title` 中展示快捷键提示。`FEAT-P0-P1` 与 `FEAT-P2` 均已通过用户验收。
- **最新 P3 样式与代码架构整理（2026-11-18）**：`REFACTOR-P3` 已完成落盘：
  - **`public/css/app.css` 单源化级联重构**：彻底消除多轮迭代追加在尾部的 ~80 处重复选择器覆盖与 5 处分散 `@media (min-width: 768px)`，按职责重组为 11 个单源章节（Design Tokens、Reset & Primitives、Header、About Dialog、Board Toolbar & Skeletons、Mobile Rank Cards、Desktop Rank Table、Detail Pages/Shownotes/Comments、Mini & Full Player、Drawers/Toast/Transitions、Consolidated Breakpoints），100% 保持已验收的视觉表现与优先级。
  - **跨组件去重、队列背景进度条、原地二次确认与 Android PWA 导航栏修复**：`PlaylistDrawer` 移除易被长播客名截断的行内橙色 `已听 n%` 文本，改用基于 `--listen-pct` 的条目左→右柔和背景色填充；`utils.js` 新增 `inlineConfirmMixin` 为播放列表「清空」与收听历史「清空历史」提供无弹窗的**红色原地二次确认**（首次点击变红为「确认清空」并保持 3.5 秒，再次点击执行且仍保留底部 5 秒撤销，点击面板其余位置/切 Tab/按 Esc 自动解除），抽离 `computeProgressPercent` 与 `formatProgressBadge` 统一四处收听进度逻辑；`api.js` 为前端内存详情缓存增加 `MAX_DETAIL_CACHE = 60` FIFO 淘汰上限；`site.webmanifest` 移除写死的品牌橙 `"theme_color": "#e04f26"`（并将 `background_color` 对齐 `#f7f4ec`），交由 `index.html` 的浅/深双 `prefers-color-scheme` `<meta name="theme-color">` 与运行时脚本控制状态栏，避免 Android Chrome WebAPK（如 Pixel 4 XL 三键导航栏）将底部虚拟导航栏静态染成刺眼橙色。资源版本升至 `app.css?v=33`、`app.js?v=35`，`sw.js` 升至 `v8`。
- **当前仓库状态**：`npm test` **81/81** 全部通过；仓库已关联 Cloudflare Workers Builds，推送到 `origin/main` 后自动构建部署上线（`https://xyz.keyi.ma`）。
