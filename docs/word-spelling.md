# 错词拼写

在错题本手动勾选历史错词，点击「拼写所选」。按选择顺序去重，每组 10 个，整组首轮完成后把拼错、查看答案或跳过的词回练一次；组间手动继续。练习页面为 `/recall/spelling/:id`，`/recall` 保留复测入口和旧会话，并提供拼写选词及续练入口。

交互参考 TypeWords，键入逻辑在本项目独立实现。正确字母高亮、错误字母标红；错误后需要先退格，正确前缀不会自动清空。兼容手机输入、粘贴、全角字符、大小写、弯引号、连字符和词组空格。查看答案由服务端记录为提示，后续跟打不算首次无错。机械键盘音和成功提示音默认开启，可在偏好设置或拼写页关闭，选择保存在当前设备。音效由浏览器本地生成，不需要模型、语音服务或外部素材。

## 记录与恢复

- 首轮分别记录首次无错、纠正后完成、查看答案后完成、跳过；回练结果单独记录，不覆盖首轮。
- 服务端事务和版本号保护进度，创建和作答请求使用 UUID 幂等键。当前词之外的未练拼写不随题目返回。
- 本模块是即时反馈训练，浏览器需要持有当前词完整拼写。完整答案仍由服务端校验；逐字错误计数属于客户端训练信息，不用于竞赛或排名。
- 服务端逐词保存进度，浏览器草稿按账号、会话、首轮/回练和题目隔离。暂停、后台和失去窗口焦点期间不计时。
- 新增迁移 `038_word_spelling.sql` 只创建独立会话、结果表。不写入原有记忆强度、复测日期或学习证据，也不删除历史错词。

## 接口

- `GET /api/v1/spelling`：可恢复练习及最近完成记录。
- `POST /api/v1/spelling`：`wordIds`、`requestKey`；仅接收当前账号错题本单词，最多 10000 个，超限明确报错。
- `GET /api/v1/spelling/:id`：恢复当前进度。
- `POST /api/v1/spelling/:id/actions`：`requestKey/revision/action`，动作 `answer/reveal/skip/next`；作答携带 `wordId/answer/errorCount/durationMs`。

## 验证

```powershell
node --test server/tests/unit.spelling.test.js server/tests/unit.collectionSelection.test.js
npm run build
$env:SPELLING_INTEGRATION_TEST='1'
node --test server/tests/integration.spelling.test.js
```

集成测试新建并保留 `blm_spelling_<时间戳>_test` 数据库，只复制开发库所需的表结构，不复制用户数据，不清空或删除任何库。覆盖真实 HTTP/MySQL 下的账号隔离、手动选词、超过 10 词、并发重复提交、回练及旧学习数据不变。不要使用项目原有的删库测试助手运行这组验证。
