# 雅思专项接入

在网页侧栏或安卓底栏的“更多”进入“雅思专项”。专项包含听说读写训练、模考、个人记录、词汇和管理入口。

## 安装与迁移

使用 Node.js 24 和 MySQL 8。安装依赖并备份数据库后，运行 `npm run db:migrate`，再运行 `npm run db:ielts` 导入内置草稿。数据库以完整文件名记录迁移，雅思和背词迁移可以使用相同的数字前缀。设置 `IELTS_ENABLED=false` 可以关闭专项接口及后台任务。

## 发布与录音

内置材料是待复核的教学草稿。管理员可提交复核，核对来源、题目、答案、音频和计时后再发布。公开环境的专项起步词汇需要完成复核后配置 `IELTS_STARTER_VOCAB_REVIEWED=true`。

录音校验需要安装 ffprobe，或通过 `FFPROBE_PATH` 指定可执行文件。录音保存在 `IELTS_MEDIA_DIR` 指定的私有目录，默认 `server/media`，部署时请为该目录配置持久存储。

运行 `npm run test:ielts:unit` 可检查专项规则。完整 API 测试会重建测试库。
