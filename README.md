# 背了么

Vue 3 + Node.js + MySQL 的学生英语学习项目，仅用于非商业学习与展示。

## 本地启动

需要 Node.js 22 或以上、MySQL 8。

1. `npm ci`。
2. 将 `server/.env.example` 复制为 `server/.env`，设置数据库连接和固定的 `JWT_SECRET`。首次设置 `AI_KEY_ENCRYPTION_SECRET` 后请保持不变；已有密钥依赖当前加密配置，不要随意轮换。
3. `npm run db:setup` 创建结构并导入词书；`node server/src/db/importIelts.js` 可单独导入项目保留的雅思词表。
4. `npm run start:all`，打开 http://127.0.0.1:5173/ 。

已有安装升级先运行 `npm run db:migrate`，再重启后端。

## API 与账号绑定

注册登录后，在“设置”里保存一次自己的 API Key。服务端按登录账号加密存入 MySQL，不在浏览器存放 API Key 明文，也不会通过接口回传明文。

刷新、重新登录会自动恢复当前账号已绑定的 API 配置。输入框留空代表沿用已经保存的同服务商 Key，可直接更换模型、获取模型列表或测试连接。切换账号会清理上一账号的页面缓存；数据不会在不同账号间共享。API 连接失败时可以重新测试，不必重复粘贴。

请备份自己的数据库和服务器加密配置。GitHub 只保存代码、测试和公开词库，不包含个人 API Key、数据库或 `.env`。

## 已有功能

- 分层自适应词汇测评、保存恢复与复测。
- 背词、错因分析、复习计划；数字键 1–4 选择、空格继续。
- 点餐、问路、bank 多义场景的多轮对话；文字／麦克风输入、四级帮助、可调纠错严格度、结束小结与薄弱词回流。
- 雅思等词书、词根词缀拆解与记忆库。
- 暖纸、磨砂暗黑和林间主题。

麦克风识别需要独立的语音服务配置；AI 回复朗读使用浏览器自带能力。账号注册、API 配置和真机验收见 [情境练习接入待办](docs/情境练习接入待办.md)。

## 词库来源

雅思词表来源及许可见 `third_party/ielts/README.md`。
词根词缀来源及重建步骤见 `third_party/morpholex/README.md`。MorphoLex 派生数据采用 CC BY-NC-SA 4.0，限非商业用途；morphemes 为 MIT。原始许可证随仓库保留。

## 验证

`npm run build` 构建前端。`npm run test:server` 使用独立的 `beileme_test` 数据库执行测试，会重建该测试库，不要把开发数据库配置为测试库。AI 测试使用模拟服务，不产生模型调用费用。
