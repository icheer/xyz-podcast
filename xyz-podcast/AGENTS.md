# AGENTS.md — XYZ Podcast (小宇宙热门播客收听端)

> 本文档是跨会话、多 Agent 接力开发的**唯一架构权威与交接规范**。任何 Agent 接手前必须先阅读本文件与 `CHECKLIST.md`，并在每次任务推进时**实时同步更新进度**，确保文档与代码现状严格一致。

---

## 1. 项目定位与核心目标

基于民间小宇宙热门榜单站 [xyzrank.com](https://xyzrank.com/) 的 4 个榜单数据与 [xiaoyuzhoufm.com](https://www.xiaoyuzhoufm.com/) 官网公开页面内容，构建一个**手机端优先、兼顾 PC 端**的播客发现与在线收听 Web 应用。

- **技术形态**：Cloudflare Workers 全栈单仓库（参考 [icheer/aigc-gallery](https://github.com/icheer/aigc-gallery) 的无前端构建模式）。
- **数据策略**：
  1. **首页 4 大榜单**由 Cloudflare Cron 每日 2 个时刻（北京时间 `08:00` 与 `20:00`，即 UTC `00:00` 与 `12:00`）启动同步，通过兼容 Cloudflare Free Plan 的**分批接力状态机**抓取 `xyzrank.com` 全量数据并存入 **Cloudflare D1 (SQLite)**，再由自建 `/api/boards/*` 对外提供搜索、排序与分页服务。
  2. **播客频道页 & 单集播放页**均内置在本项目前端路由中（保留"去小宇宙官网"外链），所需数据（频道单集列表、单集音频地址、Shownotes、热评列表）由 Worker 后端**按需实时**携带浏览器 UA/Referer 请求小宇宙官网解析返回，**不做预取与数据库缓存**。
- **核心收听体验**：全局常驻迷你播放器 + 可展开全屏播控页（切换榜单/逛频道不断播）、向前 30 秒 / 向后 15 秒、倍速调节、循环模式（顺序 / 单曲 / 列表循环）、白名单流式音频下载、播放列表与拖拽调序、基于 `localStorage` 的断点续播进度保存与恢复。
- **已知边界**：小宇宙官网网页端不提供逐字稿正文（仅 App 端有），本项目不实现字幕/逐字稿功能。

---

## 2. 技术栈与目录规划

### 2.1 运行时与后端
- **Cloudflare Workers** + **Wrangler v4**（无 TypeScript 编译/打包器需求，直接原生 ES Modules JS）。
- **存储**：**Cloudflare D1 (SQLite)**，Binding 名为 `DB`。
- **静态资源托管**：Workers Static Assets (`[assets]` 配置 `directory = "./public"`，`binding = "ASSETS"`，`not_found_handling = "single-page-application"`，`run_worker_first = ["/api/*"]`)，实现零构建多文件拆分与 SPA History 路由兜底。
  - 若需极简内嵌单文件方案，也可参考 `aigc-gallery` 的 `import indexHtml from "../public/index.html" with { type: "text" }`，但本项目含 3 类视图 + 全局播放器 + 播放列表抽屉，**优先使用 `public/` 多文件 + `[assets]`** 以避免单文件膨胀导致后续 Agent 编辑困难。

### 2.2 前端（零构建，CDN / unpkg）
- **核心框架**：`vue@3/dist/vue.global.prod.js`（**严格使用 Options API 风格**，不用 `<script setup>` / Composition API / `.vue` 单文件编译）。
- **路由**：`vue-router@4/dist/vue-router.global.prod.js`（HTML5 History 模式或 Hash 模式；推荐 History 模式配合 Worker SPA fallback）。
- **第三方 JS 库（通过 `unpkg.com` 引入，避免重复造轮子）**：
  - `dompurify@3/dist/purify.min.js`：净化小宇宙 `shownotes` 富文本 HTML，防 XSS。
  - `sortablejs@1/Sortable.min.js`：播放列表条目移动端触摸拖拽 + PC 鼠标拖拽调序。
  - `lucide@latest/dist/umd/lucide.min.js`：线性图标库（注意 Vue DOM 更新后通过指令或 `$nextTick` 调用 `lucide.createIcons()`）。
  - `dayjs@1/dayjs.min.js`（可选，或配合轻量原生工具函数）：日期及相对时间格式化。
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
├── .gitignore                # 忽略 node_modules、.wrangler、.dev.vars、.env
├── migrations/
│   └── 0001_init.sql         # D1 表结构迁移脚本
├── src/
│   ├── index.js              # Worker 入口：fetch() 路由分发 + scheduled() Cron 入口
│   ├── db/
│   │   ├── schema.js         # D1 查询/UPSERT/版本切换辅助函数
│   │   └── sync.js           # xyzrank 分批接力同步状态机
│   ├── handlers/
│   │   ├── boards.js         # /api/boards/* 榜单查询、搜索、排序、分页、元信息
│   │   ├── xiaoyuzhou.js     # /api/xiaoyuzhou/podcast/:pid 与 /episode/:eid 实时抓取解析
│   │   ├── download.js       # /api/audio/download 白名单流式下载代理
│   │   └── admin.js          # /api/admin/sync 手动同步与状态查询（ADMIN_KEY 鉴权）
│   └── utils/
│       ├── http.js           # JSON 响应、CORS/缓存头、参数与 ID 白名单校验
│       └── parser.js         # __NEXT_DATA__ 提取与字段清洗（纯函数，便于单测）
├── public/
│   ├── index.html            # SPA 入口 HTML（引入 CDN Vue3 / Router / unpkg 依赖）
│   ├── css/
│   │   └── app.css           # CSS 变量、移动端卡片流、PC 适配、播放器与抽屉样式
│   └── js/
│       ├── api.js            # 前端 fetch 封装
│       ├── storage.js        # localStorage 管理：播放列表队列、断点续播进度、倍速/循环设置
│       ├── utils.js          # 时长格式化、时间戳识别转换、数字缩写（1.2万）
│       ├── components/
│       │   ├── RankBoard.js      # 4 榜单展示组件（移动端卡片 / PC 表格、搜索/排序/加载更多）
│       │   ├── PodcastView.js    # 播客频道页（简介 + 最新 15 集 + 快捷播放/加队列）
│       │   ├── EpisodeView.js    # 单集播放页（Shownotes 时间戳跳转 + 热评区 + 下载）
│       │   ├── PlayerBar.js      # 底部迷你播放器 + 展开全屏播控页（-15s/+30s/倍速/循环）
│       │   └── PlaylistDrawer.js # 播放列表抽屉（SortableJS 拖拽排序 + 上移/下移/移除）
│       └── app.js            # Vue 3 Options API 根实例、VueRouter 初始化、全局音频控制器
└── test/                     # Node 内置 test runner (node --test) 单元测试
    ├── parser.test.js
    └── sync.test.js
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

### 3.2 `xiaoyuzhoufm.com` 实时抓取契约

> ⚠️ **2026-11-17 实测阻塞发现**：Cloudflare Workers（含本地 `workerd` 与线上边缘节点）在所有出站 `fetch()` 上由平台层强制注入 `CF-Worker` 请求头，且 Worker 代码无法删除/屏蔽该请求头；而 `www.xiaoyuzhoufm.com`（`Potato-Server` / OpenResty）明确对携带 `cf-worker` 请求头的请求返回 **`HTTP 403 Forbidden`**（同一环境下不含该头的 `curl` 与 Node `fetch()` 均返回 `200 OK`）。音频 CDN `media.xyzcdn.net` 则不受 `cf-worker` 头影响，可直接在 Worker 中正常流式代理下载。后续需根据用户决策采用**非 Worker 运行时**或**外部轻量转发网关（不带 `CF-Worker` 头）**解决小宇宙页面抓取。

- Worker 请求小宇宙官网时携带以下请求头：
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
    - 约 **20~21 条热评**，含 `id`, `pinned`, `text`, `likeCount`, `createdAt`, `ipLoc`, `badges`, `author` (`nickname`, `avatar.picture.smallPicUrl/thumbnailUrl`), `replies[]`（二级回复）。
    - **已核实限制**：未登录网页端无评论分页 API，前端需展示提示「当前展示热门精选评论，查看更多请前往小宇宙 App」。
- **音频 CDN (`media.xyzcdn.net`) 特性（已实测）**：
  - 支持 `Accept-Ranges: bytes`，`<audio src="https://media.xyzcdn.net/...">` 可直接播放并拖动进度条。
  - 响应头**不含** `Access-Control-Allow-Origin: *`，因此浏览器端 `<a download>` 跨源无法按单集标题重命名下载；必须由 Worker 提供白名单流式代理接口 `/api/audio/download`。
  - 前端 HTML `<head>` 建议设置 `<meta name="referrer" content="no-referrer">`，避免第三方图片/音频后续收紧防盗链。

---

## 4. 数据库与 Free Plan 分批接力同步设计

### 4.1 为什么采用 D1 + 分批接力状态机
- 全量 4 个榜单共约 9,132 条（~93 页 `limit=100` 请求）。
- Cloudflare Workers **Free Plan** 每次触发上限为 **50 次外部 `fetch()` subrequest**、**10ms CPU 时间**（注：D1 查询不计入 50 次外部 `fetch` 限额）。
- 单次 Cron 无法拉完 93 页，因此采用 **时间窗高频脉冲 + D1 状态机接力**：
  - `wrangler.toml` 仅配置 **1 个** Cron Trigger：`crons = ["*/2 0,12 * * *"]`（对应北京时间 `08:00–08:58` 与 `20:00–20:58` 每 2 分钟触发一次）。
  - 每次 `scheduled()` 最多发起 **25~30 次** `fetch()`（为重试预留安全余量，且分批写入 D1 控制单次 CPU 远低于 10ms）。
  - 拉取顺序优先小榜单后大榜单：`episodes` (8 页) -> `new-episodes` (1 页) -> `new-podcasts` (2 页) -> `podcasts` (82 页)。
  - **Tick 1 (`00:00` / `12:00`)** 即可同步完 3 个完整榜单 + 热门播客 Top 1,900；约 4 个 Tick（~6 分钟）完成全部 93 页并将该时段 `sync_runs.status` 置为 `completed`；同小时剩余 Tick 查表见已完成即刻 `return`（0 次外部请求）。

### 4.2 原子版本切换（读写隔离）
- 每次同步生成唯一 `sync_version`（如 `20261117T00`）。
- 新拉取数据带 `sync_version` 写入 `episodes_rank` / `podcasts_rank` / `board_meta`。
- 前端 API 读取 `app_state.active_sync_version` 对应的完整版本；仅当整轮 4 个榜单全部 `completed` 时，更新 `active_sync_version` 并异步/顺带清理早于前 1 个版本的旧数据（保留最近 1~2 个版本防回退失败）。
- **冷启动兜底**：若 `active_sync_version` 尚未存在（首次部署刚启动第 1 批），允许回退读取最近一条 `sync_runs` 的已入库数据，保证首次部署几分钟内即有数据可看。

### 4.3 D1 表结构要点 (`migrations/0001_init.sql`)
- `episodes_rank`: `(id PK, sync_version, board, rank, eid, title, podcast_id_raw, podcast_name, logo_url, link, play_count, comment_count, subscription, duration_min, post_time, primary_genre, total_episodes_count, open_rate, interactive_rate, last_release_days)` + 索引 `(sync_version, board, rank)`、`UNIQUE(sync_version, board, eid)`。
- `podcasts_rank`: `(id PK, sync_version, board, rank, pid, raw_id, name, logo_url, primary_genre, authors_text, track_count, last_release_date, last_release_days, first_episode_time, active_rate, avg_duration_min, avg_play_count, avg_update_freq_hours, avg_comment_count, avg_interact_indicator, avg_open_rate, xyz_url, links_json)` + 索引 `(sync_version, board, rank)`、`UNIQUE(sync_version, board, raw_id)`。
- `board_meta`: `(sync_version, board, total, synced_count, median_values_json, updated_at, PRIMARY KEY (sync_version, board))`。
- `sync_runs`: `(run_id PK, slot, status, current_board, current_offset, pages_fetched, items_written, retry_count, last_error, locked_until, started_at, finished_at)`。
- `app_state`: `(key PK, value, updated_at)`。

---

## 5. 后端 API 规范

| 方法与路径 | 鉴权 | 说明 |
|---|---|---|
| `GET /api/health` | 无 | 健康检查与 D1 连通性检测 |
| `GET /api/boards/meta` | 无 | 返回当前 `active_sync_version` 及 4 榜单总数、更新时间、分类列表 |
| `GET /api/boards/:board` | 无 | 分页查询榜单；参数 `offset` (0), `limit` (<=100), `q`, `genre`, `sort` (白名单映射 SQL 列), `dir` (`asc`\|`desc`) |
| `GET /api/xiaoyuzhou/podcast/:pid` | 无 | 实时抓小宇宙播客页并解析返回 `{ podcast, episodes, limited: true, sourceUrl }` |
| `GET /api/xiaoyuzhou/episode/:eid` | 无 | 实时抓小宇宙单集页并解析返回 `{ episode, comments, limited: true, sourceUrl }` |
| `GET /api/audio/download` | 无 | 参数 `url`, `filename`；严格校验 `url` 域名白名单后流式转发音频并附加 `Content-Disposition: attachment` |
| `POST /api/admin/sync` | `X-Admin-Key` | 手动触发同步（支持 `{ reset?: boolean, batches?: number }`，冷启动/调试用） |
| `GET /api/admin/sync/status` | `X-Admin-Key` | 查看 `sync_runs` 与 `active_sync_version` |

> **安全边界**：
> - `pid` / `eid` 必须做正则校验（如 `/^[a-zA-Z0-9]{16,36}$/`），禁止构造任意路径/SSRF。
> - `/api/audio/download` 仅允许 `https:` 且 hostname 白名单（`media.xyzcdn.net` 或 `*.xyzcdn.net`、`*.xiaoyuzhoufm.com`），禁止内网 IP 或任意域名代理。
> - `/api/boards/:board` 的 `sort` 字段必须使用**显式白名单字典**映射到 SQL 列名，严禁字符串拼接用户输入。
> - `ADMIN_KEY` 通过 `.dev.vars`（本地）和 `wrangler secret put ADMIN_KEY`（线上）配置，绝不硬编码或提交 git。

---

## 6. 前端交互与播放器规范

### 6.1 路由与页面
1. **首页 4 榜单 (`/`, `/hot-podcasts`, `/hot-episodes-new`, `/new-podcasts`)**
   - 顶部吸顶导航：Logo、全局搜索框（400ms 防抖）、4 榜单 Tab 切换、排序选择器、分类筛选、同步时间徽章。
   - **移动端 (`< 768px`)**：卡片流布局（排名、正方形封面、主标题、播客名/主播、关键指标标签；单集卡片附「▶ 播放」「+ 队列」按钮）。
   - **PC 端 (`>= 768px`)**：自适应高信息密度表格或宽卡片（支持列头排序、中位数提示），保留快捷播放/入队与进内页交互。
   - 触底 `IntersectionObserver` 自动加载下一页（或手动"加载更多"兜底）。
2. **播客频道页 (`/podcast/:pid`)**
   - 展示频道封面、标题、主播、简介（可展开）、订阅/总集数、"去小宇宙官网"外链。
   - 最新 15 集列表：支持单集「▶ 播放」「+ 加入播放列表」「看详情/Shownotes」，以及「将本页 15 集全部加入播放列表」快捷操作；显示网页端 15 集限制提示。
3. **单集播放页 (`/episode/:eid`)**
   - 展示单集封面、标题、可点击跳转到 `/podcast/:pid` 的所属播客链接、发布时间、时长、数据指标、付费/试听提示（如适用）、"去小宇宙官网"外链。
   - 操作区：「▶ 播放 / ⏸ 暂停」「+ 加入播放列表」「⬇ 下载音频」。
   - **Shownotes**：经 `DOMPurify.sanitize()` 净化渲染，识别文内 `HH:MM:SS` / `MM:SS` 时间戳转为可点击高亮按钮，点击即自动加载当前单集并跳转到对应秒数播放。
   - **热评区**：渲染置顶/热评列表、IP 属地、徽章、点赞数及二级回复，并展示约 20 条热评限制提示。

### 6.2 全局播放器与 `localStorage` 持久化
- 根组件维护单一 `<audio>` 实例与 `playerState`（保证切换页面时音频持续播放）。
- **核心播控**：
  - 播放/暂停、进度条拖动（实时预览目标时间，松手 `seek`）。
  - **后退 15 秒 (`-15s`)**、**前进 30 秒 (`+30s`)**。
  - **倍速切换**：`0.75x`, `1.0x`, `1.25x`, `1.5x`, `1.75x`, `2.0x`。
  - **循环模式三态**：`sequential`（顺序播完列表后停）、`repeat-one`（单曲循环）、`repeat-all`（列表循环）。
  - 集成浏览器 `navigator.mediaSession` API（锁屏封面、标题、快进/快退/上下曲控制）。
- **播放列表 (`PlaylistDrawer`)**：
  - 支持增删、一键清空、**SortableJS 拖拽排序**（配拖拽手柄避免与移动端页面滚动冲突），并额外提供上移/下移/置顶按钮确保可访问性。
- **进度保存与恢复 (`localStorage`)**：
  - Key 命名规范（建议前缀 `xyzp_v1_`）：
    - `xyzp_v1_queue`：当前播放列表及 `currentEid`
    - `xyzp_v1_progress`：以 `eid` 为键的进度映射 `{ [eid]: { currentTime, duration, finished, updatedAt } }`（上限保留最近 200 条按 `updatedAt` 淘汰）
    - `xyzp_v1_prefs`：`{ playbackRate, loopMode }`
  - 每播放 3~5 秒、暂停、`seeked`、切集、`pagehide`/`beforeunload` 时持久化；下次加载同一 `eid` 时若 `currentTime > 5` 且未 `finished`（剩余 > 5s）自动定位续播，并给予轻提示（如"已恢复至 12:34"）。

---

## 7. 常用命令与验证方式

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
curl "http://localhost:8787/__scheduled?cron=*/2+0,12+*+*+*"

# 运行单元测试（Parser、工具函数、Sync 状态机）
npm test                     # node --test

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
1. 运行与本次改动匹配的验证（单元测试 `npm test`、本地 `wrangler dev` 实测接口/页面、语法检查等），**严禁未验证即标记完成**。
2. 更新 `CHECKLIST.md`：将完成项改为 `[x]`，并简要写明**验证方式与实测结果**（或阻塞原因 `[!]`）。
3. 更新本文档第 9 节 **"当前进度与交接快照"**（以及如有结构/接口变更同步更新第 2~7 节）。
4. 按 `CLAUDE.md` 规范做原子化 git commit（Conventional Commits：`feat:` / `fix:` / `docs:` / `test:` / `chore:`）。

---

## 9. 当前进度与交接快照

- **最后更新**：2026-11-17
- **当前阶段**：`Phase 3 部分完成并在 P3-02/P3-03 遇到平台层阻塞（等待用户确认方案）`
- **已完成事项**：
  - `Phase 0`：完成上游接口实测调研、架构确认与交接规范建立。
  - `Phase 1`：完成工程脚手架、D1 schema 迁移、`src/index.js` 与 `src/db/schema.js`。
  - `Phase 2`：完成 `src/db/sync.js` 分批接力同步状态机（本地 D1 已同步 9,132 条全量榜单数据）、`src/handlers/admin.js`、`src/handlers/boards.js` 与 `scheduled()` Cron 接入。
  - `Phase 3` (`P3-01`, `P3-04`)：完成 `src/utils/parser.js`（`__NEXT_DATA__` 提取与清洗）、`src/handlers/download.js`（白名单流式音频下载代理已在 `wrangler dev` 实测通过）与 `src/handlers/xiaoyuzhou.js`；`npm test` 15/15 通过。
- **当前阻塞与实测结论**：
  - `P3-02`（`/api/xiaoyuzhou/podcast/:pid`）与 `P3-03`（`/api/xiaoyuzhou/episode/:eid`）在 `wrangler dev` (`workerd`) 下均收到小宇宙 `403 Forbidden`。
  - **已定位根因**：`workerd` 与 Cloudflare Workers 生产环境会在所有出站 `fetch()` 强制附带 `CF-Worker` 请求头（Cloudflare 文档确认不可在 Worker 脚本中去除），`www.xiaoyuzhoufm.com` 对含 `cf-worker` 头的请求直接返回 `403`（同机器下无该头的 `curl` 与 Node `fetch()` 均正常返回 `200`）。
- **下一位 Agent 的精确起点**：待用户决定采用 **方案 A（Cloudflare Workers + 外部轻量转发网关如 Vercel/Deno/VPS `XYZ_RELAY_URL`）**、**方案 B（整体迁移至 Node.js + SQLite）** 或 **方案 C（先完成 Phase 4–6 前端与播放器）** 后继续推进。
