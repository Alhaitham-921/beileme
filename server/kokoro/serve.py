"""Local CPU-only Kokoro worker. Bind loopback; expose through authenticated Node API."""
import base64, hashlib, io, json, os, time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import soundfile as sf
from kokoro_onnx import Kokoro
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = Path(os.environ.get('KOKORO_MODEL_DIR', ROOT / 'output/kokoro/models'))
options = ort.SessionOptions()
options.intra_op_num_threads = max(1, min(4, os.cpu_count() or 2))
options.inter_op_num_threads = 1
session = ort.InferenceSession(str(MODEL_DIR / 'kokoro-v1.0.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
model = Kokoro.from_session(session, str(MODEL_DIR / 'voices-v1.0.bin'))
cache = OrderedDict()
cache_bytes = 0
MAX_CACHE = 64 * 1024 * 1024

def synthesize(text, speed):
    global cache_bytes
    key = hashlib.sha256(json.dumps([text, speed, 'af_heart'], ensure_ascii=False).encode()).hexdigest()
    if key in cache:
        cache.move_to_end(key)
        return cache[key], True
    samples, rate = model.create(text, voice='af_heart', speed=speed, lang='en-us')
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format='WAV', subtype='PCM_16')
    audio = buf.getvalue()
    cache[key] = audio
    cache_bytes += len(audio)
    while cache_bytes > MAX_CACHE and cache:
        _, removed = cache.popitem(last=False)
        cache_bytes -= len(removed)
    return audio, False

class Handler(BaseHTTPRequestHandler):
    def reply(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try: self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError): pass
    def log_message(self, fmt, *args): pass
    def do_GET(self):
        if self.path != '/health': return self.reply(404, {'error': 'Not found'})
        self.reply(200, {'status': 'ok', 'engine': 'kokoro-onnx', 'voice': 'af_heart'})
    def do_POST(self):
        if self.path != '/synthesize': return self.reply(404, {'error': 'Not found'})
        if not self.headers.get('Content-Type', '').startswith('application/json'):
            return self.reply(415, {'error': 'JSON required'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 20000: raise ValueError('Invalid payload size')
            value = json.loads(self.rfile.read(size))
            text = value.get('text')
            speed = value.get('rate', 1)
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1500: raise ValueError('Text length must be 1-1500')
            if isinstance(speed, bool) or not isinstance(speed, (int,float)) or not 0.5 <= speed <= 1.5: raise ValueError('Invalid rate')
        except (ValueError, TypeError, AttributeError):
            return self.reply(400, {'error': 'Invalid text or rate'})
        started = time.perf_counter()
        try:
            audio, hit = synthesize(text.strip(), speed)
            self.reply(200, {'audioBase64': base64.b64encode(audio).decode(), 'mimeType': 'audio/wav', 'cached': hit, 'generationMs': round((time.perf_counter()-started)*1000)})
        except Exception as error:
            print('Kokoro synthesis failed:', type(error).__name__, flush=True)
            self.reply(503, {'error': 'Synthesis failed'})

print('Warming up Kokoro English voice...', flush=True)
synthesize('Welcome to Beileme.', 1)
print('Kokoro ready at http://127.0.0.1:3003', flush=True)
HTTPServer(('127.0.0.1', 3003), Handler).serve_forever()
