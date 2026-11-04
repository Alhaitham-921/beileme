# Linux / Docker 部署背了么

本配置将网页入口、Node API、MySQL、Kokoro 分为四个服务。只把网页入口绑定到宿主机的 `127.0.0.1:8088`，数据库、API 和语音工作进程不发布宿主机端口。适合与服务器原有网站共存。主机需要 Docker Engine 和 Compose 插件；支持普通 Docker 或 Rootless Docker。

## 普通账号与 Rootless Docker

Ubuntu 普通账号需要管理员一次性安装 `uidmap`、为账号提供 subordinate UID/GID 范围，并启用后台常驻。管理员示例（把用户名换成实际部署账号）：

```bash
sudo apt-get update
sudo apt-get install -y uidmap
sudo loginctl enable-linger YOUR_USER
```

检查 `/etc/subuid`、`/etc/subgid` 中当前账号是否各有至少 65536 个映射。Rootless Docker 安装方式与用户级 systemd 管理见 [Docker 官方说明](https://docs.docker.com/engine/security/rootless/)。Rootless 不提供管理员权限，也不需要停止服务器原有容器或网站。

Rootless 二进制可能位于 `~/bin`，Compose 和 Buildx 插件位于 `~/.docker/cli-plugins/`。`deploy/compose.sh` 会优先使用当前账号 `~/bin/docker`。在当前 shell 中手动使用 Docker 时，可以先执行 `export PATH="$HOME/bin:$PATH"`。

## 新安装

在自己的独立目录克隆仓库，并在仓库根目录执行：

```bash
sh deploy/init-env.sh
sh deploy/compose.sh build
sh deploy/compose.sh up -d db
sh deploy/compose.sh run --rm api npm run db:setup
sh deploy/compose.sh up -d
sh deploy/compose.sh ps
```

首次构建需要下载基础镜像、npm/Python 依赖及 Kokoro 模型。`db:setup` 会联网导入公开词书。已有数据库迁移时，应使用经过核对的备份恢复流程，避免用示例数据替代真实学习记录。

`deploy/init-env.sh` 首次生成独立随机数据库密码、JWT 密钥及 API 加密密钥，文件权限为 600。重复执行保留已有值。`deploy/api.env` 是自动生成的 API 环境，排除了数据库 root 密码；修改配置请编辑 `deploy/.env`，通过 `deploy/compose.sh` 执行后续命令时会刷新生成文件。两份环境文件均不提交 Git，也不进入镜像构建上下文。

API 启动前自动执行未应用的数据库迁移，等待数据库健康后才启动；网页等待 API 健康后再启动。模型在构建镜像时下载，运行时先预热。容器内通过 `KOKORO_BIND_HOST=0.0.0.0` 提供内部访问，电脑本机默认仍只监听 loopback。

## 访问、HTTPS 与没有域名的测试

暂未确定域名时，可以在自己的电脑上建立 SSH 转发：

```bash
ssh -L 8088:127.0.0.1:8088 YOUR_USER@SERVER_IP
```

然后打开 `http://localhost:8088`。公网访问时将自有子域名的 HTTPS 入口代理到服务器 `http://127.0.0.1:8088`，并把 `deploy/.env` 的 `PUBLIC_ORIGIN` 改成实际 HTTPS Origin 后执行 `sh deploy/compose.sh up -d`。服务器已有 80/443 服务时，应由管理该入口的人添加独立站点，不覆盖现有站点。

没有自有域名也可使用 [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) 获得临时 HTTPS 测试地址，无需 Cloudflare 账号。启动客户端时应通过 `--config` 显式指定本项目独立配置，避免自动读取服务器其他站点的 Cloudflare 全局配置或凭据。其地址会随隧道重建改变，没有可用性保证，也不支持 SSE，因此仅作为测试或演示入口。公网手机网页录音需要安全上下文；直接 HTTP IP 地址不能完整替代 HTTPS。

安卓版把 `.env.android.local` 的 `VITE_API_BASE_URL` 设置为实际 HTTPS 地址加 `/api/v1`，重新构建。保持 `https://localhost` 在后端允许的 Origin 中。临时隧道变更地址后，旧 APK 的固定 API 地址也需更新；长期使用应固定访问地址。

## 配置、数据迁移与更新

- 账号、学习数据、收藏、情境记录及已保存 API 配置都在 MySQL 命名卷中。Kokoro 不需要把模型上传 GitHub，数据库卷不会随普通容器重建而删除。
- 保存好 `deploy/.env`。加密主密钥改变会导致已有 API 配置无法解密。迁移时需要保留原加密种子，或在迁移副本中按新种子重新加密已有凭据。开发用 JWT 密钥不能直接用于生产环境；更换 JWT 后需要重新登录。
- 发信配置及个人 API 凭据应由部署者单独配置或在明确授权后迁移。不要放进 Dockerfile、镜像层、Git 仓库或公开构建日志。
- SQL 备份应保持私有、验证完整性及恢复后的记录数量，再切换访问入口。电脑上的数据不会自动与服务器双向同步。
- 更新源码后执行 `sh deploy/compose.sh up -d --build`，再验证网页、健康检查和学习流程。`sh deploy/compose.sh logs --tail=80 api` 可检查 API 启动情况。
- 生产环境当前仍按单个 API 实例设计；语音和部分邮件限额会受反向代理与单进程计数方式影响。暂不声明已支持多实例生产部署。

迁移文件在 `.gitattributes` 中固定为 LF，避免 Windows 与 Linux 的换行差异导致已有数据库的迁移校验和不一致。

## 固定子域名切换

免费 DDNS 子域名可解析到服务器公网 IPv4，但不会自动提供 HTTPS 或穿透端口。申请后先核对 A 记录；没有可用 IPv6 时不要填写 AAAA。先确认宿主机 443 的实际监听程序，若该端口由其他服务使用，应由入口管理员决定如何共存；不要直接停止原服务或给 Nginx 添加冲突监听。

待新 HTTPS 入口、证书自动续期及反向代理全部验证后，将 `PUBLIC_ORIGIN` 设置为新地址。过渡期间可通过 `EXTRA_CORS_ORIGINS` 保留旧地址（多个用英文逗号分隔）。执行 `sh deploy/compose.sh up -d --no-deps api` 使允许的来源生效，再检查新旧网页及 Android 来源 `https://localhost`，不重建数据库或语音服务。

随后更新 `.env.android.local` 的 `VITE_API_BASE_URL` 并重新打包，保留原安装包供回退。用户账号和学习记录仍使用同一个数据库。确认全部切换后，再单独移除旧来源和临时隧道。
