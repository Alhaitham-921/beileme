"""Download the fixed upstream Kokoro v1.0 assets while building the image."""
import os
from pathlib import Path
from urllib.request import urlopen
import shutil

models = Path(os.environ.get('KOKORO_MODEL_DIR', '/models'))
models.mkdir(parents=True, exist_ok=True)
release = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'
for name in ('kokoro-v1.0.onnx', 'voices-v1.0.bin'):
    print('Downloading ' + name, flush=True)
    with urlopen(release + name, timeout=120) as response, (models / name).open('wb') as target:
        shutil.copyfileobj(response, target, length=1024 * 1024)
