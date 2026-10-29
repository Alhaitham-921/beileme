$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$logDirectory = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Test-Endpoint([string]$Uri) {
    try {
        $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Wait-Endpoint([string]$Uri) {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-Endpoint $Uri) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Service did not become ready: $Uri. Check logs in $logDirectory"
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/vite/bin/vite.js'))) {
    throw 'Dependencies are missing. Run npm ci in the project folder first.'
}

$backendHealth = 'http://127.0.0.1:3001/api/v1/health'
if (-not (Test-Endpoint $backendHealth)) {
    Start-Process -FilePath $nodePath -ArgumentList @('server/src/server.js') `
        -WorkingDirectory $projectRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDirectory 'local-backend.log') `
        -RedirectStandardError (Join-Path $logDirectory 'local-backend-error.log') | Out-Null
    Wait-Endpoint $backendHealth
}

$frontendUrl = 'http://127.0.0.1:5173/'
if (-not (Test-Endpoint $frontendUrl)) {
    $previousBrowser = $env:BROWSER
    try {
        $env:BROWSER = 'none'
        Start-Process -FilePath $nodePath `
            -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort') `
            -WorkingDirectory $projectRoot -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $logDirectory 'local-frontend.log') `
            -RedirectStandardError (Join-Path $logDirectory 'local-frontend-error.log') | Out-Null
    } finally {
        $env:BROWSER = $previousBrowser
    }
    Wait-Endpoint $frontendUrl
}

Wait-Endpoint 'http://127.0.0.1:5173/api/v1/health'
Write-Output 'Beileme is ready: http://localhost:5173/#/settings'
