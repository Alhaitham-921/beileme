# 安卓 App 开发与真机调试

背了么的 Android App 复用 Vue 界面，通过 Capacitor 打包。本阶段交付可安装的 **调试 APK**；后端和 MySQL 仍运行在电脑上，AI 与语音识别仍需要电脑联网。

## 已配置的内容

- Android 工程：`android/`，应用名“背了么”，应用 ID `com.beileme.app`。
- 独立的 Android 网页构建：`.env.android` 默认连接 `http://127.0.0.1:3001/api/v1`，不改变浏览器版的接口配置。
- 本机 SDK/JDK 路径自动检测及缓存：`.android.local.json` 和 `android/local.properties`，均不提交 Git。
- 构建缓存默认位于 `%LOCALAPPDATA%\Beileme\AndroidCache\`，不修改系统环境变量，也不覆盖捏捏谷的 JDK。Gradle 公共缓存和 Android 用户配置分别位于其中的 `gradle/`、`android-user/`；项目缓存按工程路径的哈希分目录，避免不同工程相互混用。
- `android:setup` 仅给已有后端配置合并 Android 本地来源 `https://localhost`，不修改数据库信息、JWT 密钥或 API Key。已运行的后端需重启一次才会读取新配置。
- USB 转发：手机的 `127.0.0.1:3001` 转发到电脑同一端口，不要求手机和电脑连接同一 Wi-Fi，也无需开放电脑防火墙端口。
- 已配置麦克风权限、系统返回键、状态栏与导航栏避让；安卓朗读使用系统文字转语音引擎，小结导出打开系统分享。

USB 方式必须保持数据线连接、电脑后端和 MySQL 运行。拔线后，这个本地演示 APK 无法访问电脑数据；APK 内不包含后端、数据库或模型密钥。

## 第一次准备电脑

在项目目录打开终端：

```powershell
npm ci
npm run android:setup
npm run android:build
```

已安装依赖时可以省略 `npm ci`。构建会自动运行 Android 网页构建及 Capacitor 同步，再调用项目的 Gradle Wrapper；首次需要下载 Gradle、Android 插件和 Maven 依赖。无需单独安装全局 Gradle。

成功后 APK 位于：

```text
output/android/beileme-debug.apk
```

若当前机器已运行旧后端，先在其终端按 `Ctrl+C`，再运行 `npm run server`。如果后端通过原来的启动脚本在后台运行，先关闭那个旧进程，再双击 `start-beileme.cmd`。不要同时启动两个占用 `3001` 的后端。

本机可复用的工具路径：

```text
Android SDK: F:\coding\codex\nieniegu\tools\android-sdk
JDK 21: %LOCALAPPDATA%\Beileme\Toolchains\jdk21\<解压得到的 jdk-21... 目录>
```

如果组员机器路径不同，可通过下面的命令指定。SDK 需要 Android API 36。当前原生依赖（包括 Filesystem 插件）显式要求 **JDK 21 工具链**：已有 JDK 23 虽能运行 Gradle，也不能替代这个精确版本；JDK 17 同样不适用。脚本会自动扫描上述 `jdk21` 目录的一层子目录，或者使用明确指定的 JDK 21。现有 JDK 17 和 JDK 23 保留不变，不需要卸载。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/android.ps1 -Action Setup -SdkPath "D:\Android\Sdk" -JdkPath "D:\Java\jdk-21"
```

当前机器的 F 盘对目录重命名会返回 `AccessDenied`，而 Gradle 生成缓存时需要重命名临时目录，因此默认将缓存放在 C 盘用户目录。若需要更换缓存位置，可指定一个允许目录重命名的本地目录：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/android.ps1 -Action Setup -CachePath "C:\Users\你的用户名\AppData\Local\Beileme\AndroidCache"
```

指定的缓存根目录会保存为 `.android.local.json` 中的 `cachePath`，以后构建自动复用。不要将它重新指向当前有目录重命名限制的 F 盘。

找不到工具时，可安装 Android Studio，并在 **Tools → SDK Manager** 安装 Android SDK Platform 36、SDK Platform-Tools、SDK Command-line Tools 和工程要求的 Build-Tools。仅使用命令行工具也能构建；不需要为了当前这套已安装的 SDK 重新下载整套环境。

## 手机端必须手动完成的步骤

1. 准备安卓手机与**能传输数据**的 USB 线，解锁手机。
2. 打开手机“设置 → 关于手机”，连续点击“版本号”约 7 次，按提示输入锁屏密码。不同品牌可能位于“系统版本”或“软件信息”中。
3. 回到设置，找到“开发者选项”，开启 **USB 调试**。
4. 用 USB 线连接电脑。若仅显示充电，尝试切换为“文件传输”，或换数据线/USB 接口。
5. 手机弹出“允许 USB 调试吗”时，核对这是自己的电脑，勾选“始终允许使用这台计算机进行调试”，点击“允许”。
6. 在电脑项目目录运行 `npm run android:doctor`。设备列表中应出现一行序列号，状态为 `device`。
7. 运行 `npm run android:install`，或者双击项目根目录 `start-android.cmd`。脚本会检查后端、建立 USB 转发、安装 APK 并启动应用。
8. 部分品牌会在安装时要求允许“通过 USB 安装”或再次确认，按手机提示操作。
9. 进入应用后使用电脑后端已有账号登录，或注册新账号。第一次主动录音时，允许 App 使用麦克风。

首次真机验收建议依次检查：登录、打开情境、录音并编辑识别文字、播放英文朗读、生成小结并分享 PDF/PNG。
再试一次系统返回键、弹出软键盘、切到后台，确认输入区可见且录音停止。
如果提示缺少朗读引擎或英语语音包，在手机设置中搜索“文字转语音”或“TTS”，启用可用的系统引擎并下载英语（美国）语音。
这部分取决于手机品牌和系统，无法在尚未连接的手机上代为设置。

当前支持的最低安卓版本由 `android/variables.gradle` 的 `minSdkVersion` 决定；Capacitor 8 默认最低 Android 7.0（API 24）。优先使用较新版本安卓真机验证录音与 WebView。

## 以后每次演示

已安装 APK 且代码没有变更时：

```powershell
npm run android:connect
```

这会检查后端、必要时调用现有本地启动脚本，并重新建立 USB 转发。之后在手机上打开“背了么”。**重插数据线、重启手机或重启 ADB 后，都应重新执行连接命令。**

修改代码后：

```powershell
npm run android:build
npm run android:install
```

`install -r` 会尝试保留 App 数据；不要为解决网络问题随意卸载 App。调试签名变化可能导致覆盖安装失败，此时先确认需要保留的数据，再处理旧安装。

同时连接多台设备时，明确选择序列号：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/android.ps1 -Action Install -Serial YOUR_DEVICE_ID
```

## 常见卡点

| 现象 | 处理方法 |
| --- | --- |
| 设备列表为空 | 手机解锁，开启 USB 调试，换数据线/接口；必要时安装手机品牌提供的 Windows USB 驱动。仅能充电的线不能用于 ADB。 |
| 显示 `unauthorized` | 在手机确认“允许 USB 调试”；若没有弹窗，关闭再开启 USB 调试并重插。 |
| 显示 `offline` | 解锁并重插手机，稍等再运行 `android:doctor`。 |
| 提示 Android CORS 尚未生效 | `android:setup` 已修改配置，但原后端仍使用旧配置；重启后端再执行 `android:connect`。 |
| 后端健康检查失败 | 确认 MySQL 正在运行、`server/.env` 已按 README 配置，查看 `logs/local-backend-error.log`。脚本不会替换密码或重建数据库。 |
| 登录/加载失败 | 保持 USB 线连接，重新执行 `android:connect`；本地演示版无法离开电脑独立使用。 |
| Gradle 下载失败 | 检查电脑网络；首次构建需要访问 Gradle 分发站、Google Maven、Maven Central。网络恢复后重试 `android:build`，已有缓存会复用。 |
| 首次录音被拒绝 | 手机设置 → 应用 → 背了么 → 权限，允许麦克风后重试。录音和朗读仍需真机验收。 |

## 以后改成连接云端

部署后端和数据库后，在项目根目录新建 **不提交 Git** 的 `.env.android.local`，只写公开 API 地址：

```dotenv
VITE_API_BASE_URL=https://你的后端域名/api/v1
```

然后重新运行 `android:build` 和 `android:install`。云端后端也要允许 App 来源 `https://localhost`。本机调试网络策略仅允许回环地址使用明文 HTTP；其他地址应使用有效证书的 HTTPS。**不要把 AI Key、数据库密码或 JWT 密钥写入任何 `VITE_` 变量，这些会进入 APK。**

云端版不依赖 USB 转发；上面的 `android:connect` 和 `android:install` 主要服务于本地 USB 演示，云端部署完成后可用 ADB 单独安装并启动 APK。正式分发还需要独立的发布签名、版本管理和完整验收，当前调试 APK 不等同于应用商店发布包。
