# Kokoro 本机朗读

新版背了么使用 CPU 上的 kokoro-onnx 0.6.1，模型 Kokoro v1.0，英语音色 af_heart。没有调用付费 TTS API。

## 本机启动

双击 start-new-version.cmd 会先启动并预热 Kokoro，再启动前后端。手机重连执行 connect-phone.cmd，也会检查并启动模型。启动脚本不会停止旧版进程。

- 网页：5174，Node API：3002，Kokoro 内部服务：127.0.0.1:3003。手机只访问 Node API。
- 单独启动：powershell -ExecutionPolicy Bypass -File scripts/start-kokoro.ps1
- 日志：output/kokoro/worker.log 和 worker-error.log。
- 模型及 Python 虚拟环境：output/kokoro/，不提交 Git；不要删除或移动。
- 接口：POST /api/v1/tts/synthesize，要求登录，正文 {text, rate}；长度1–1500字符，语速0.5–1.5。每账号每分钟20次，一次只处理一个请求，忙时提示重试。
- 英语合成结果在内存缓存，上限64MB，重启清空；不把学习文本写入磁盘缓存。语音识别和文字AI沿用现有配置。
- 音频以WAV返回，手机/WebView播放，不要求系统TTS引擎。长于1500字符需分句朗读。

## 复现与迁云

Python 3.12 创建虚拟环境，安装 server/kokoro/requirements.txt；本机完整版本见 output/kokoro/requirements-lock.txt。下载模型和音色见 https://github.com/thewh1teagle/kokoro-onnx 。保持进程常驻，配置进程管理器自启动。Linux使用对应虚拟环境Python执行 server/kokoro/serve.py；默认模型目录 output/kokoro/models，也可通过 KOKORO_MODEL_DIR 指定。Node默认访问本机3003/synthesize，可通过KOKORO_URL覆盖。Windows启动脚本不能直接用于Linux。

模型权重 Apache-2.0：https://huggingface.co/hexgrad/Kokoro-82M 。kokoro-onnx 为MIT；其他依赖许可证随安装包保留。未来ARM云实例需要重新安装平台依赖并复测，不复制Windows虚拟环境。

## 本机测试（2026-11-02，模型预热后）

52英文字符：首次1399ms，缓存10ms；141字符：首次3800ms，缓存16ms。音频分别约2.63秒和7.97秒。结果为本机CPU单请求，未包含手机播放和公网，不代表云端或多人性能。试听文件及数据位于output/kokoro/。

## 首次在另一台 Windows 电脑配置朗读

先安装 Python 3.12，在项目根目录运行以下命令。已有环境不必重复创建。

```powershell
py -3.12 -m venv output/kokoro/venv
& .\output\kokoro\venv\Scripts\python.exe -m pip install -r server/kokoro/requirements.txt
New-Item -ItemType Directory -Path output/kokoro/models -Force | Out-Null
Invoke-WebRequest -Uri 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx' -OutFile output/kokoro/models/kokoro-v1.0.onnx
Invoke-WebRequest -Uri 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin' -OutFile output/kokoro/models/voices-v1.0.bin
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-kokoro.ps1
```

模型来源为上游 [model-files-v1.0 发布页](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0)。若命令行下载失败，可从该页手动下载同名文件，放入上述 models 目录。模型和音色需要额外下载空间，首次安装与下载耗时不属于后续单句朗读延迟。

配置好后可运行 `start-new-version.cmd` 启动朗读与前后端。`npm run start:all` 只启动前后端；要使用朗读，请同时保持 Kokoro 进程运行。Windows 的快捷启动及手机连接脚本会检查朗读环境，未配置时会提示按本文安装。

SMTP、文字模型及识别服务的凭据须由各部署者单独配置。源码中没有本机账号、学习记录、发信授权码或可直接共享的 API Key。
