# 网上资料如何用于本项目的测评与效果验证

核对日期：2026-11-18。结合当前自编 A/B 起点短测、SM-2 复习、看图练习和按义项保存的学习证据梳理。已核对以下发布方、研究作者或官方维护的页面；本轮没有导入外部学习者数据到真实账号，也没有修改题库、分数阈值或线上配置。

## 功能模块与实际运行

项目已有账号安全、词汇与学习复习、自测及历史分析、搭配、看图回忆、情境、雅思等功能模块，后端分别有路由和业务服务，页面也按功能组织。这属于逻辑分工。

业务模块目前共同运行在一个 Node 应用中；部署配置把网页、API、MySQL、Kokoro 作为不同服务运行。数据库在自己的服务中保存账号数据，录音使用服务器持久化目录。它们是部署组成，不应与“每个业务模块都独立部署”混为一谈。依据 `server/src/routes/index.js` 和 `compose.yaml`。

## 1. 词汇测验：Victoria University of Wellington 的官方资源

发布方页面：[Vocabulary tests](https://www.wgtn.ac.nz/lals/resources/paul-nations-resources/vocabulary-tests)。

提供 Vocabulary Levels Test、Vocabulary Size Test，以及不同适用程度、语言版本和部分 A/B 卷资源；Updated VLT 有配套的两卷开发与验证研究。已打开官方 Updated VLT B 下载地址，确认 PDF 可访问：
[Updated VLT B](https://www.wgtn.ac.nz/__data/assets/file/0025/40966/The-updated-Vocabulary-Levels-Test-B.pdf)。

可做：参考测验结构、适用学习者和词频分层，为自编题建立外部对照。不能推定：我们现在每档八题的中文四选一题，已经继承原测验的可靠性或两卷等值结果。修改语言、题型、取题数量及内容后的测验需要重新验证。这是基于二者测量任务不相同作出的应用判断。

官方页面明确 Updated VLT 的研究使用无需许可；本轮没有据此认定产品内再分发、改编或商业用途也获许可。当前自测定位是可选的起点参考，不因找到标准化测验而自动改成强制测试或精确词汇量测量。

## 2. 真实复习记录：Duolingo HLR

作者官方仓库：[duolingo/halflife-regression](https://github.com/duolingo/halflife-regression)。

仓库说明提供约 1300 万条学习追踪，字段包括匿名学习者、语言、词项、距上次练习时间、历史作答和本轮回忆表现。仓库还有模型与评估方法，可据此设计离线比较。

数据入口：[Harvard Dataverse，DOI 10.7910/DVN/N8XJME](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/N8XJME)。仓库列出的压缩数据约 361 MB，本轮只核对公开说明和入口，没有下载整个数据集；Dataverse 页面及 API 未能通过当前网页工具读取详细元数据，因此文件可下载状态、数据许可条目及完整性仍需实际获取时核对，不能把仓库 MIT 标识直接当成所有外链文件的许可结论。

可做：建立遗忘预测模型、复习规则的外部离线基准。应用前须核对字段语义：例如 `p_recall` 是本轮相关练习的正确比例，不能直接当成单道中文选择题的二元结果。当前 SM-2 输出复习间隔，不直接输出同定义的回忆概率，需要适配评价任务。训练和测试须按学习者及时间避免泄漏。

不能推定：外部平台的学习记录证明本项目的 A/B 题等难，或证明本平台让用户提高。外部数据不应写入本项目的用户成绩表，不应伪装成本平台用户试用数据。

## 3. 图词互动：2026 年公开实验

作者论文：[Duolingo-inspired pretesting with words and pictures improves vocabulary learning](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965936/)。

研究比较带反馈的图词猜测与直接阅读，并进行后续测试。材料以西班牙语名词为主；论文提供实验材料、数据和代码的 [OSF 链接](https://osf.io/s8gvp/)。本轮读到论文，但 OSF 页面未能通过当前网页工具打开，尚未逐个核验数据文件及原始图片许可。

可做：参考互动、反馈及不同测试方式的实验设计，也可在取得数据后尝试复现。不能推定：这些名词实验已经验证我们生成的介词、抽象词图片准确，或证明本平台长期学习效果。论文报告的实验效果不得改写成本平台效果；原图许可按具体材料核对。

## 4. 词义难度：English Vocabulary Profile

官方说明：[English Vocabulary Profile user guide](https://www.englishprofile.org/images/pdf/evp%20user%20guide.pdf)；开发者研究：[Completing the English Vocabulary Profile](https://www.cambridge.org/core/journals/english-profile-journal/article/completing-the-english-vocabulary-profile-c1-and-c2-vocabulary/418955FC7ED2455E98A499BC40C2C816)。

该资源按词义及短语提供 CEFR 级别信息，可作为我们“同词不同义项分别处理”的设计参考。它描述学习者的表现，不能仅凭一个词的等级计算用户的整体 CEFR 水平。官方资源入口及联系页还有非商业使用限制说明，不能据此默认允许整库复制进产品。可先用于人工研究对照，不自动批量抓取或入库。

## 适合本项目的采用顺序

先整理外部测验的适用范围和可用许可，审查自编 A/B 的题目、干扰项与义项；再获取并核验可使用的公开学习记录，在独立研究目录建立离线基准；图词实验用于改进验证方案。任何据此调整的题库或方法另立版本，保留旧报告，避免混算。

对老师可说明：系统设计参考公开测评和学习研究，并用外部数据做离线比较；自编试卷的本地等值与本产品实际效果，仍需要在本项目用户中验证。公开资料能降低从零研究的成本，不能替代所有本地验证。
