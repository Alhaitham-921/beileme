# 背了么 · 后端服务

「背了么」的 Node.js + MySQL 后端。前端（Vue 3 SPA）目前仍使用 localStorage，
本服务的接口已按 [产品需求文档](../需求文档/背了么_产品需求文档%20(1).md) 完整实现，
下一步只需把前端 store 切到 HTTP 调用即可（见文末「前端接入清单」）。

---

## 一、技术选型

| 项目 | 选择 | 说明 |
|---|---|---|
| 运行时 | Node.js ≥ 22（当前验证版本 26.1.0） | 依赖 `fetch`、`process.loadEnvFile` 等内置能力 |
| Web 框架 | Express 5 | 原生支持 async 处理器抛错自动转交错误中间件 |
| 数据库 | MySQL 8.0 | 使用 JSON 列存释义/例句/队列，`CHECK` 约束做业务兜底 |
| 驱动 | mysql2/promise | 连接池 + 预编译语句 |
| 校验 | zod 4 | 请求参数校验，错误逐字段返回 |
| 鉴权 | JWT（access）+ 数据库刷新令牌（refresh，可轮换） | 口令哈希用 Node 内置 `crypto.scrypt`，零额外依赖 |
| 测试 | Node 内置 `node:test` | 188 个用例，含真实 MySQL 的端到端流程 |

刻意保持依赖精简（生产依赖仅 5 个），没有引入 ORM：表结构以 SQL 迁移文件为唯一事实来源，
数据访问集中在 `src/services/*` 里，后续若换 PostgreSQL 只需替换这一层。

---

## 二、目录结构

```
server/
├── .env.example              环境变量模板（复制为 .env）
├── src/
│   ├── config.js             配置集中入口，启动时加载 .env
│   ├── app.js                Express 应用装配（可被测试直接引用）
│   ├── server.js             进程入口：连通性自检 + 优雅退出
│   ├── db/
│   │   ├── pool.js           连接池、query/execute、事务封装
│   │   ├── migrate.js        迁移执行器（含校验和防篡改）
│   │   ├── seed.js           词库/徽章导入（幂等）
│   │   └── migrations/*.sql  表结构，按文件名顺序执行
│   ├── middleware/           auth / validate / errorHandler
│   ├── utils/                errors、http、json、password、token、time
│   ├── services/             业务逻辑（SRS、错因、计划、统计、徽章）
│   │   └── ai/               provider 抽象、Prompt 模板、生成与配额
│   └── routes/               路由层，只做参数校验与调用 service
└── tests/                    单元测试 + 端到端接口测试
```

---

## 三、快速开始

```bash
# 1. 配置连接信息（.env 已被 .gitignore 忽略）
cp server/.env.example server/.env
#    至少确认 DB_USER / DB_PASSWORD / DB_NAME / JWT_SECRET

# 2. 建库建表 + 导入开源词库（可重复执行）
npm run db:setup

# 3. 启动
npm run server        # 前台运行
npm run server:dev    # 文件变更自动重启

# 4. 验证
curl http://127.0.0.1:3001/api/v1/health
```

前端联调：`npm run dev` 启动 Vite 后，`/api` 会被代理到 `http://127.0.0.1:3001`
（见 `vite.config.js`），前端直接用相对路径请求即可，无需处理跨域。

### 可用脚本

| 命令 | 作用 |
|---|---|
| `npm run db:migrate` | 只执行未应用的迁移 |
| `npm run db:import` | 从开源词库导入真实词书（8 本、3 万词），可重复执行 |
| `npm run db:import -- --refresh` | 忽略本地缓存，强制重新下载词表 |
| `npm run db:import -- --inspect` | 只解析并打印统计，不写数据库 |
| `npm run db:import -- --book=cet4` | 只导入指定词书 |
| `npm run db:seed` | 导入 80 词的内置示例词库（仅供测试与离线演示） |
| `npm run db:setup` | 迁移 + 导入开源词库 |
| `npm run server` | 启动 API 服务 |
| `npm run test:server` | 运行全部后端测试（会重建 `beileme_test` 库） |

> 测试库名必须以 `_test` 结尾，测试脚本会 `DROP DATABASE` 重建它；
> 命名不符时直接抛错，避免误删开发库。

---

## 四、数据库设计

17 张业务表（另有 1 张 `schema_migrations` 迁移记录表），按职责分三个迁移文件。

### 用户与词库（`001_core.sql`）

| 表 | 说明 |
|---|---|
| `users` | 账号。邮箱与手机号各自唯一，`CHECK` 保证至少填一个；`token_version` 自增即可让已签发令牌全部失效 |
| `refresh_tokens` | 刷新令牌，只存 sha256 哈希，支持轮换与撤销 |
| `user_profiles` | 学习画像（Onboarding 结果）。`topic_weights` 随用户行为演化，实现「越用越懂你」 |
| `user_api_keys` | 用户自带 AI Key（PRD 4.8），密文字段已预留，功能待 P1 落地 |
| `wordbooks` / `words` | 词书与单词。`definitions`/`examples` 用 JSON 数组，`spelling_norm` 支撑唯一约束 |
| `word_relations` | 形近/近义词关系，`relation_type` 区分 `form`/`meaning`，`score` 为相似度 |

### 学习进度（`002_progress.sql`）

| 表 | 说明 |
|---|---|
| `user_word_progress` | **核心表**。SRS 参数（`ef`/`repetitions`/`interval_days`）、`memory_strength`、`next_review_at`、各项计数 |
| `study_sessions` | 学习会话。`queue` 列保存题目快照（含正确选项），既支持刷新恢复，也让对错判定留在服务端 |
| `answer_logs` | 答题流水，等价于 PRD 中的 `history`，独立成表避免 JSON 无限膨胀 |
| `user_error_stats` | 错因聚合（用户×单词×错因），支撑「反复在同一组词间答错」的升级判定 |
| `daily_plans` | 每日计划与 Todo，同时充当每日统计快照与打卡日历数据源 |

### AI 内容与游戏（`003_content.sql`）

| 表 | 说明 |
|---|---|
| `generated_contents` | 短文/理解题/对比卡片/小结。`cache_key` 支撑跨用户复用，`content_hash` 用于历史去重 |
| `ai_usage` | 按用户×日期×类型计数，实现每日额度与降级 |
| `badges` / `user_badges` | 徽章字典与解锁记录（PRD 4.6.2） |
| `game_records` | 小游戏战绩。游戏本身纯规则实现，此处仅落库并回写错因证据 |

### 迁移约定

- 文件名 `NNN_name.sql`，按序执行，执行记录写入 `schema_migrations`。
- **已应用的迁移不可修改**：校验和变化会直接报错，请新增迁移文件（`004_session_queue.sql` 就是这么加列的）。
- 连接池设置 `timezone: 'Z'`，数据按 UTC 存储；`dateStrings: ['DATE']` 让 `DATE` 列保持
  `'YYYY-MM-DD'` 字符串形态。业务日期按 `APP_TIMEZONE_OFFSET_MINUTES`（默认 UTC+8）切分，
  否则东八区用户晚上 8 点后的学习会被算进 UTC 的次日。

---

## 五、词库从哪里来

词表不是手写的，全部来自两个开源仓库，由 `npm run db:import` 自动下载、解析、入库。

### 5.1 数据来源

| 词书 code | 名称 | 规模 | 来源 |
|---|---|---|---|
| `primary` | 小学英语大纲词汇 | 428 | mahavivo：小学英语大纲词汇（裸词表，释义由其他词表补全） |
| `zhongkao` | 中考核心词汇 | 1,986 | KyleBing：`1 初中-乱序.txt` |
| `gaokao` | 高考核心词汇 | 3,739 | KyleBing：`2 高中-乱序.txt` |
| `cet4` | 大学英语四级大纲词汇 | 4,537 | mahavivo：`CET4_edited.txt`（2016 版四六级考试大纲） |
| `cet6` | 大学英语六级大纲词汇 | 2,219 | mahavivo：`CET6_edited.txt` |
| `npee` | 考研核心词汇 | 5,390 | mahavivo：`NPEE_Wordlist.txt` |
| `toefl` | 托福核心词汇 | 4,507 | mahavivo：`TOEFL.txt` |
| `gre` | GRE 核心词汇 | 7,718 | mahavivo：`GRE_8000_Words.txt` |

合计 **30,524 个词条**。仓库地址：`mahavivo/english-wordlists`、`KyleBing/english-vocabulary`。

词表下载后缓存在 `server/data/wordlists/`（已 gitignore），因此导入可以离线重跑。
脚本对 GitHub contents API 与 raw 地址各做三次指数退避重试，并对 UTF-8/GBK 两种编码自动识别。

> **雅思没有开源词表**：两个仓库都不提供，因此 `雅思` 目标暂时映射到托福学术词表，
> 映射表在 `sources.js` 的 `GOAL_TO_BOOK` 里，注释已标明。要补真实雅思词表只需加一条 source 与一行映射。

### 5.2 解析器要处理的脏数据

`services/wordlist/parse.js` 支持三种排版，都是真实存在的格式，不是假想出来的：

```
A. 带音标   abandon [əˈbændən] vt.丢弃；放弃，抛弃
            about   [ˈəbaut] prep.关于…周围
            abandon [əˈbændən] v. 1. 抛弃，放弃 2. 离弃(家园、船只、飞机等)   ← 带编号
            abandon [ə'bændən]        vt.  放弃,沉溺n.  放任                  ← 空格对齐，词性夹在释义中间
B. 裸词表   abandon
C. 制表符   although	conj. 尽管；虽然；但是；然而
```

几个必须处理的坑（都有对应测试）：

- **词性可能夹在释义中间**：`放弃,沉溺n. 放任` 里的 `n.` 要能被识别。用 `(?<![A-Za-z])` 而不是
  `\b` 做前缀判断——反直觉的是，正因为 `\b` 不认汉字，才能匹配到紧跟在中文后面的词性。
- **词性同时也是释义分界**：`boat n. 小船；轮船 v. 划船` 里的 `v.` 必须替换成分隔符而非空格，
  否则「轮船」和「划船」会粘成一条释义。
- **括号内的顿号不能切分**：`离弃(家园、船只、飞机等)` 是一个整体，按顿号切会得到
  「离弃(家园」「船只」这类毫无意义的选项，因此切分时要跟踪括号层级。
- **括号本身不能修剪**：`一(个)` 是配对括号，当成标点削掉会变成 `一(个`。
- **同一个词按词性分行**：初高中词表里 `miss` 有名词和动词两条，去重时必须合并释义而不是丢弃
  （实测初中词表 3223 行里有 1236 行是这种情况）。
- **缩略词带点**：`a.m.` 不能被截断成 `a`。
- **表头与分段字母**：`大学英语四级大纲单词表`、`(共 4615 词)`、单独的 `A`/`B`/`C` 都要跳过，
  且**不能计入「解析失败」统计**，否则会虚高数据质量指标。

### 5.3 词频与难度怎么来的

开源词表本身不带词频标注，用同仓库的 **COCA 20000 词频表**（按出现频率排序）推导：

- 先取每个词的 COCA 排名（未收录的排到最后）
- 再按**书内分位数**分档：前 25% 为 `high`，中间 50% 为 `med`，后 25% 为 `low`
- 难度 1-5 同样按分位数映射（越常见越简单）

用分位数而不是绝对阈值，是因为 GRE 词表里几乎全是低频词，用绝对阈值会导致整本书都是 `low`，
「高频优先」这个学习顺序就失去意义了。

### 5.4 易混词关系

导入时自动为每本书重建形近/近义关系，共 **134,632 条**。算法见下一节。

### 5.5 重新导入

导入是幂等的：重复执行只更新词条内容，不会产生重复数据，也**不会删除词条**
（删除会通过外键连带清空用户在那本书上的学习进度）。要换词表来源，改 `sources.js` 后重跑即可。

---

## 六、核心业务逻辑

### 6.1 SRS 间隔重复（PRD 4.2.2）

`src/services/srs.js`，在 SM-2 之上扩展了三个维度：

1. **犹豫时长 → 质量分**：答错 = 1；答对且 ≤3s = 5；答对但更慢 = 3（低置信度）。
2. **低置信度惩罚**：质量分为 3 时，间隔再乘 0.8。
3. **易混词惩罚**：该词存在形近/近义混淆历史时，间隔乘 0.7。

答错后 `repetitions` 清零，重学间隔按错因决定（盲猜 0.25 天 → 最快再见一次）。

`memory_strength`（0-100）= 连对次数 35% + 难度因子 25% + 历史正确率 25% + 反应速度 15%，
最近一次答错则压低上限 40，避免「历史正确率很高但刚忘掉」的词排到队尾。

### 6.2 错因分析引擎（PRD 4.2.3）

`src/services/errorAnalysis.js` 是纯函数，按以下**优先级**判定（顺序影响结果）：

| 顺序 | 条件 | 错因 | 重学间隔 |
|---|---|---|---|
| 1 | 拼写模式字母顺序错误 | `spelling_weak` 拼写薄弱 | 1 天 |
| 2 | < 1.5s 就选错 | `guess` 盲猜/生疏 | 0.25 天 |
| 3 | 选错的释义来自形近词 | `form_confusion` 形近混淆 | 1 天 |
| 3 | 选错的释义来自近义词 | `meaning_confusion` 近义混淆 | 1 天 |
| 3 | 同一组词累计错 ≥3 次 | `systematic_confusion` 系统性混淆 | 0.5 天 |
| 4 | 其余情况 | `vague` 记忆模糊 | 0.5 天 |

命中混淆类错因时，响应会附带**对比记忆卡片**：词形差异切分（公共前后缀 + 差异段，
供前端高亮）+ 语义左右对照 + 例句。这是纯算法结果，不消耗 AI 额度。

> 归因用的是「选项里记录的来源词 id」而不是释义文本：
> 多个词可能共享同一中文释义（如 accomplish 与 achieve 都含「实现」），
> 按文本反查会把错误算到别的词头上。

### 6.3 易混词关系如何计算

打分方式：

- **形近**：Levenshtein 距离归一化，共同前缀 ≥3 字母时小幅加成（形近且同词根最易混），阈值 0.6。
- **近义**：中文释义的字符 bigram + 词条重叠的加权 Jaccard，阈值 0.2。
  阈值来自实测分布：真实近义对 ≥0.267，噪声 ≤0.05，0.2 落在中间的干净间隙。

有**两套实现**，按数据规模选择，打分函数与阈值共用（`RELATION_THRESHOLDS`）：

| 实现 | 适用 | 做法 |
|---|---|---|
| `buildRelations` | 几十~几百词（内置示例词库） | 全量两两比较，简单直接 |
| `buildRelationsBulk` | 数千词（开源词库） | 分桶 + 倒排索引 |

为什么需要下面那套：6000 个词的全量两两比较约 1800 万次编辑距离计算，导入耗时无法接受。

`buildRelationsBulk` 用两个索引压缩候选集，同时保证不漏掉真正相似的词对：

1. **形近**：按首字母分组，组内按长度排序后用滑动窗口比较。
   编辑距离 ≤ d 必然满足长度差 ≤ d，所以长度窗取 4 已覆盖所有得分 ≥0.6 且长度 ≥10 的组合。
   **元音开头的词合并成一个组**——`affect/effect`、`accept/except`、`adopt/adept` 这类
   「元音互换」正是最典型的形近混淆，按首字母硬分会整对漏掉（实测 effect/affect 得分 0.833，被正确捕获）。
2. **近义**：用释义的字符 bigram 建倒排索引。任何 bigram 重叠非零的词对必然共享至少一个 bigram，
   因此这个索引是完备的；只对超大桶（如「的」这种高频组合）做截断以免退化。

导入后共生成 **134,632 条**关系（形近 11.6 万、近义 2.3 万），经典易混对
（adapt/adopt 0.8、principal/principle 0.878、effect/affect 0.833、access/assess 0.667）全部命中。

### 6.4 每日计划与自适应调节（PRD 4.6）

- Onboarding 时按「剩余词数 ÷ 剩余天数」平摊出每日新词量，并以时长预算为硬上限（5-50 之间）。
- 当日 `new_target` / `review_target` 在首次访问时**固化**，避免背完后数字跳变。
- 次日若昨日未完成，返回四选一询问；**最多每 2 天触发一次**：
  - `too_hard` → 新词量 ×0.7，标记更基础的难度倾向
  - `too_much` → 新词与复习量各 ×0.7，并把昨日欠账合并进复习队列（上限 40）
  - `no_time` / `skip` → 计划量不变，仅记录

### 6.5 AI 生成的成本控制（PRD 4.3.6）

- **缓存复用**：`cache_key` = 目标词组合 + 难度 + 学习目标 + 话题的 sha256（与词序无关）。
  缓存窗口内命中直接返回，**不计入额度**，只累计 `cached_count`；缓存池跨用户共享。
- **分层生成**：新词例句一律用词库预置例句（零成本），只有短文/理解题/对比卡片才调模型。
- **额度与降级**：按类型设置每日额度，超限返回 429 并提示可复习历史内容；
  未配置 Key 时 AI 接口返回 503，但**背词主链路完全不受影响**。
- **历史去重**：用词级 3-gram Jaccard 近似摘要向量相似度，达到 `DEDUP_SIMILARITY_THRESHOLD`（0.85）
  则换话题重新生成一次。

### 6.6 个性化保证（PRD 4.4）

「相同词表不同输出」由三层机制保证：用户画像作为强 Prompt 变量（目标/词汇量/记忆偏好/历史易混词）
+ 话题池按用户权重随机抽取 + 非零 temperature。所有生成一律经过 `promptTemplates.js`，
System Prompt 固定了「服务于当前词表、难度不脱节、内容健康、结构固定、原创」等预设约束，
即使用户接入自己的 Key 也无法绕过（PRD 4.8）。

---

## 七、API 一览

统一前缀 `/api/v1`。除标注「公开」外都需要 `Authorization: Bearer <accessToken>`。

### 认证 `/auth`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` | 公开。`{email?, phone?, password, nickname?}`，密码 ≥8 位且含字母与数字 |
| POST | `/auth/login` | 公开。`{account, password}`，account 自动识别邮箱/手机号 |
| POST | `/auth/refresh` | 公开。`{refreshToken}`，**轮换**：旧令牌立即失效 |
| POST | `/auth/logout` | 撤销全部刷新令牌并自增 `token_version` |
| GET | `/auth/me` | 当前用户与画像 |
| POST | `/auth/password` | 改密，成功后所有设备需重新登录 |

登录/注册响应：

```json
{
  "ok": true,
  "data": {
    "user": { "id": 1, "email": "a@b.com", "nickname": "", "createdAt": "..." },
    "tokens": { "accessToken": "...", "refreshToken": "...", "tokenType": "Bearer", "expiresIn": "2h" },
    "profile": { "goal": "", "newPerDay": 15, "isOnboarded": false }
  }
}
```

### 画像 `/profile`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/profile` | 取画像 |
| PUT | `/profile` | 部分更新（goal/examDate/selfLevel/dailyTime/newPerDay/memoryPrefs/topicWeights…） |
| POST | `/profile/onboarding` | 完成引导：写画像 + **按目标选词书** + 算每日新词量 + 生成当日计划 |
| GET | `/profile/wordbooks` | 可选词书列表 |

### 词书与单词 `/words`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/words/books` | 公开。词书列表 |
| GET | `/words/books/:code/words` | 公开。支持 `page/size/freq/difficulty` |
| GET | `/words/:id` | 公开。单词详情 |
| GET | `/words/:id/related` | 公开。形近/近义词，按相似度降序 |
| GET | `/words/:id/contrast` | 公开。对比记忆卡片（词形差异 + 语义对照），零 AI 成本 |
| GET | `/words/recent?limit=8` | 最近学过的词 + 中文释义，供主界面气泡彩蛋（PRD 4.9）；不写学习数据 |

### 背词 `/study`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/study/sessions` | `{kind: 'daily' \| 'extra'}`，返回会话与题目队列 |
| GET | `/study/sessions/:id` | 取回会话（刷新后恢复同一组题） |
| POST | `/study/sessions/:id/answers` | 提交作答，见下 |
| POST | `/study/sessions/:id/finish` | 结束会话，返回本轮统计 |
| GET | `/study/errors/digest?days=7` | 错词/错因汇总 + 每词的易混词，巩固内容素材 |

提交作答请求体：

```json
{ "wordId": 12, "optionIndex": 2, "hesitationMs": 1840, "source": "study", "spellingMistake": false }
```

> **对错由服务端判定**：接口从不下发选项的正确标记，客户端只上报所选下标。
> 拼写/阅读题等无固定选项的场景可改用 `isCorrect` + `wrongOption`。

响应（节选）：

```json
{
  "ok": true,
  "data": {
    "isCorrect": false,
    "isNewWord": true,
    "quality": 1,
    "correctText": "适应",
    "wrongOption": "采用",
    "analysis": {
      "type": "form_confusion",
      "label": "形近词混淆",
      "action": "触发易混词对比卡片，强化词形差异",
      "matchedRelatedWordId": 37,
      "needConfusableCard": true,
      "relearnDays": 1
    },
    "progress": { "state": "learning", "repetitions": 0, "intervalDays": 1, "memoryStrength": 0, "nextReviewAt": "..." },
    "confusableCard": { "word": { "spelling": "adapt" }, "contrasts": [{ "spelling": "adopt", "diff": { "prefix": "ad", "aMiddle": "a", "bMiddle": "o", "suffix": "pt" } }] },
    "unlockedBadges": [],
    "plan": { "newTarget": 20, "newDone": 1, "reviewTarget": 0, "status": "partial" }
  }
}
```

### 计划 `/plan`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/plan/today` | 今日 Todo（新词/复习/可选任务） |
| GET | `/plan/today/prompt` | 昨日未完成时的自适应调节询问（含四选项），最多每 2 天返回一次 |
| POST | `/plan/adjust` | `{reason: 'too_hard' \| 'too_much' \| 'no_time' \| 'skip'}` |
| GET | `/plan/calendar?from&to` | 打卡日历，默认最近 30 天 |
| POST | `/plan/today/article` · `/plan/today/game` | 标记可选任务完成 `{done}` |

### 统计 `/stats`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/stats/overview` | 累计背词/正确率/连续打卡/待复习/平均记忆强度 |
| GET | `/stats/trend?days=7` | 正确率趋势，无记录的日期返回 `accuracy: null`（前端渲染为「—」） |
| GET | `/stats/strength` | 记忆强度分布四档：新学/巩固中/较熟/已掌握 |
| GET | `/stats/errors?days=30` | 错因分布（饼图数据源） |
| GET | `/stats/weak-summary?days=7&ai=1` | 本周薄弱点小结。默认规则生成；`ai=1` 叠加 AI 表述 |
| GET | `/stats/hourly?days=7` | 活跃时段分布（按业务时区换算小时） |
| GET | `/stats/badges` | 徽章墙（字典 + 解锁状态） |

### AI 内容 `/content`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/content/quota` | 今日各类额度用量 + provider 配置状态 |
| POST | `/content/articles` | 生成巩固短文（命中缓存不扣额度） |
| POST | `/content/quizzes` | `{articleId, count}` 生成理解题 |
| POST | `/content/error-cards` | `{wordId}` 生成易混词对比卡片 |
| POST | `/content/weak-summary` | 生成 AI 版薄弱点小结 |
| GET | `/content?type=&page=&size=` | 历史生成记录（不含正文） |
| GET | `/content/:id` | 取单条完整内容 |

### 小游戏 `/games`

纯规则实现、不消耗 AI（PRD 4.5）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/games/records` | 上报一局结果；拼写错误可回写为「拼写薄弱」证据 |
| GET | `/games/records?game=&page=&size=` | 战绩列表 |
| GET | `/games/summary` | 各游戏最佳成绩 |

### 健康检查

`GET /api/v1/health` — 公开。返回服务状态、数据库连通性与 AI 配置状态；
数据库不可用时返回 503 且 `status: 'degraded'`。

---

## 八、统一响应格式与错误码

成功：`{ "ok": true, "data": ... }`；失败：`{ "ok": false, "error": { "code", "message", "details?" } }`。

| HTTP | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 参数校验失败，`details` 为逐字段错误 |
| 400 | `BAD_REQUEST` | 业务前置条件不满足（如提交的单词不属于当前会话） |
| 401 | `UNAUTHORIZED` / `TOKEN_EXPIRED` | 未登录 / 令牌过期 |
| 403 | `FORBIDDEN` | 无权限 |
| 404 | `NOT_FOUND` | 资源不存在。越权访问同样返回 404，不泄露资源存在性 |
| 409 | `CONFLICT` | 唯一约束冲突、重复提交、会话已结束 |
| 413 | `BAD_REQUEST` | 请求体过大 |
| 429 | `QUOTA_EXCEEDED` | AI 额度用尽，`details` 含 `limit`/`used` |
| 503 | `AI_NOT_CONFIGURED` | 未配置 AI Key，提示降级路径 |
| 500 | `INTERNAL` | 未预期异常，堆栈只进服务端日志 |

MySQL 错误会翻译成有意义的响应（`ER_DUP_ENTRY` → 409、连接失败 → 503 等），
客户端不会看到 SQL 语句或文件路径。

---

## 九、测试

```bash
npm run test:server
```

188 个用例 / 32 个套件 → 现为 **268 个用例 / 50 个套件**，约 10 秒跑完，覆盖：

- **纯单元**：SRS 参数与边界、错因判定全分支、Levenshtein/相似度/词形差异、Prompt 约束与 JSON 解析
- **词表解析**：三种排版的解析、脏数据兜底（夹在释义中的词性、括号内顿号、缩略词、表头识别、同词多词性合并）、词库来源配置的完整性
- **关系计算**：小规模全量实现与大规模分桶实现的结果一致性、元音开头的跨首字母形近对（effect/affect）
- **认证**：注册/登录/刷新轮换/登出失效/改密/账号枚举防护/口令强度
- **背词端到端**：建会话 → 作答 → SRS 更新 → 错因归因 → 流水落库 → 计划计数 → 会话统计
- **数据隔离**：跨用户读取会话、提交作答、统计互不干扰（PRD 4.7）
- **计划**：目标固化、四选项调节、欠账合并上限、打卡日历与连续天数
- **统计**：总览/趋势/强度分布/错因分布/薄弱点小结/活跃时段/徽章解锁
- **AI**：额度与降级、缓存键稳定性、去重阈值、话题抽取多样性
- **接口规约**：错误格式统一、不泄露内部细节、跨域白名单、鉴权覆盖面

测试跑在 `beileme_test` 库上，每次先 `DROP DATABASE` 重建再导入种子数据。
由于沙箱限制，测试以 `--test-isolation=none` 在单进程内运行（同时也就串行访问同一个测试库）。

---

## 十、前端接入（已完成）

前端已从 localStorage 全面切到本服务，实现方式：

| 文件 | 职责 |
|---|---|
| `src/api/client.js` | HTTP 客户端：自动注入令牌、401 静默续期并重放请求、统一拆包 `{ok,data}`、把失败转成 `ApiError` |
| `src/api/index.js` | 按模块整理的接口清单，页面只调这里，不拼 URL |
| `src/stores/auth.js` | 登录态与画像（`bootstrap` / `login` / `register` / `logout`） |
| `src/stores/app.js` | 学习数据：今日计划、背词会话、看板各图表、彩蛋数据 |
| `src/views/LoginView.vue` | 登录 / 注册（同一页两个标签） |
| `src/router/index.js` | 路由守卫：未登录 → 登录页；已登录未引导 → 引导页 |

接口地址规则（`client.js` 里的优先级）：

1. `globalThis.__BEILEME_API_BASE__` —— **单文件 HTML 部署时用这个**。导出的 HTML 若以
   `file://` 打开，相对路径 `/api` 无法解析，需在页面里先设置后端绝对地址。
2. 构建期环境变量 `VITE_API_BASE_URL`
3. 默认 `/api/v1`（开发环境下由 Vite 代理转发，见 `vite.config.js`）

需要注意的变化：

- **单词 id 变了**：前端原本用字符串（`'abandon'`），现在用数据库自增整数。旧的
  `localStorage['beileme:v1']` 数据不再被读取，也就是**旧进度不会自动迁移**。
- **词书随学习目标走**：引导页选「考研」就分到考研词表（5390 词），选「四级」分到 CET4（4537 词）。
  词书 id 会固化在画像上，之后改目标不会在不知不觉中换掉正在背的书。
- **部分词表没有音标和例句**：初高中词表不带音标，所有开源词表都不带例句。
  前端在缺音标/缺例句时会隐藏对应行，而不是留空占位（AI 生成例句正是这块的后续补位方案）。
- `src/utils/srs.js` 已删除：SRS 与错因判定由后端统一负责，前端保留一份副本只会导致两边口径漂移。
  `src/data/words.js` 保留，它现在是 `db:seed` 示例词库的数据源。
- 前端不再自己判断对错：接口不下发选项的正确标记，只上报所选下标，由服务端判定。

### 验证方式

后端测试里包含一层**前后端契约测试**（`server/tests/frontend.api-contract.test.js`），
它直接调用 `src/api/` 这层的封装函数去打真实后端，逐字段断言前端读取的字段确实存在、
类型正确（例如错因分析的 `label`/`action`、对比卡片的 `diff` 三段拼回去必须还原成原词）。
后端一旦改字段名，这里会立刻报红，不需要打开浏览器就能发现联调问题。

