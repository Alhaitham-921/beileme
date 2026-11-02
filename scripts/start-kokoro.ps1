$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
try {
    $health = Invoke-RestMethod 'http://127.0.0.1:3003/health' -TimeoutSec 2
    if ($health.engine -eq 'kokoro-onnx') { Write-Output 'Kokoro is ready'; return }
    throw 'Port 3003 is occupied by another service'
} catch {
    if ($_.Exception.Message -eq 'Port 3003 is occupied by another service') { throw }
}
$python = Join-Path $root 'output/kokoro/venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Kokoro environment is missing. See docs/Kokoro-local.md.' }
$logs = Join-Path $root 'output/kokoro'
Start-Process -FilePath $python -ArgumentList @('-u', 'server/kokoro/serve.py') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'worker.log') -RedirectStandardError (Join-Path $logs 'worker-error.log') | Out-Null
for ($i=0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    try { $health = Invoke-RestMethod 'http://127.0.0.1:3003/health' -TimeoutSec 1; if($health.engine -eq 'kokoro-onnx'){ Write-Output 'Kokoro is ready'; return } } catch {}
}
throw 'Kokoro did not become ready. Check output/kokoro/worker-error.log.'
