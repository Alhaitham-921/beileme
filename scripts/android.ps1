param(
    [ValidateSet('Setup', 'Doctor', 'Build', 'Connect', 'Install')]
    [string]$Action = 'Doctor',
    [string]$SdkPath,
    [string]$JdkPath,
    [string]$CachePath,
    [string]$Serial
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot '.android.local.json'
$apkPath = Join-Path $projectRoot 'output/android/beileme-debug.apk'
$backendHealth = 'http://127.0.0.1:3001/api/v1/health'

function Invoke-Tool([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $File $($Arguments -join ' ')"
    }
}

function Get-JavaMajor([string]$Directory) {
    $releaseFile = Join-Path $Directory 'release'
    if (-not (Test-Path -LiteralPath $releaseFile)) { return 0 }
    $line = Get-Content -LiteralPath $releaseFile | Where-Object { $_ -match '^JAVA_VERSION=' } | Select-Object -First 1
    if ($line -match 'JAVA_VERSION="(\d+)') { return [int]$Matches[1] }
    return 0
}

function Find-Sdk([string[]]$Candidates) {
    foreach ($candidate in $Candidates) {
        if (-not $candidate) { continue }
        if ((Test-Path -LiteralPath (Join-Path $candidate 'platform-tools/adb.exe')) -and
            (Test-Path -LiteralPath (Join-Path $candidate 'platforms/android-36/android.jar'))) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw 'Android SDK API 36 was not found. Install it using Android Studio SDK Manager, then run scripts/android.ps1 -Action Setup -SdkPath "YOUR_SDK_FOLDER".'
}

function Find-Jdk([string[]]$Candidates) {
    foreach ($candidate in $Candidates) {
        if (-not $candidate) { continue }
        $major = Get-JavaMajor $candidate
        if ((Test-Path -LiteralPath (Join-Path $candidate 'bin/javac.exe')) -and $major -eq 21) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw 'JDK 21 was not found. Native dependencies explicitly require a Java 21 toolchain; JDK 17 and 23 cannot replace it. Install JDK 21, then use scripts/android.ps1 -Action Setup -JdkPath "YOUR_JDK_21_FOLDER".'
}

function Initialize-Toolchain([bool]$Persist) {
    $saved = $null
    if (Test-Path -LiteralPath $configPath) {
        try { $saved = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
        catch { throw "Invalid $configPath. Correct its JSON or remove this local configuration file and run Setup again." }
    }
    $script:resolvedSdk = Find-Sdk @($SdkPath, $saved.sdkPath, $env:ANDROID_HOME, $env:ANDROID_SDK_ROOT,
        'F:/coding/codex/nieniegu/tools/android-sdk', (Join-Path $env:LOCALAPPDATA 'Android/Sdk'))
    if ($JdkPath -and ((-not (Test-Path -LiteralPath (Join-Path $JdkPath 'bin/javac.exe'))) -or (Get-JavaMajor $JdkPath) -ne 21)) {
        throw "The explicit -JdkPath must point to JDK 21 (including bin/javac.exe and release). Given: $JdkPath. The native dependencies require exactly Java 21, so JDK 17 or 23 cannot be substituted."
    }
    $toolchainsDirectory = Join-Path $env:LOCALAPPDATA 'Beileme/Toolchains/jdk21'
    $installedJdks = @(Get-ChildItem -LiteralPath $toolchainsDirectory -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'release') } |
        ForEach-Object { $_.FullName })
    $jdkCandidates = @($JdkPath, $saved.jdkPath, $env:JAVA_HOME) + $installedJdks +
        @('C:/Program Files/Android/Android Studio/jbr')
    $script:resolvedJdk = Find-Jdk $jdkCandidates
    $cacheCandidate = if ($CachePath) { $CachePath } elseif ($saved.cachePath) { $saved.cachePath } else {
        Join-Path $env:LOCALAPPDATA 'Beileme/AndroidCache'
    }
    $script:resolvedCache = [System.IO.Path]::GetFullPath($cacheCandidate)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $rootBytes = [System.Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant())
        $projectHash = ([System.BitConverter]::ToString($hasher.ComputeHash($rootBytes)) -replace '-', '').ToLowerInvariant().Substring(0, 12)
    } finally { $hasher.Dispose() }
    $script:projectCacheDir = Join-Path $resolvedCache "project-$projectHash"
    $script:adb = Join-Path $resolvedSdk 'platform-tools/adb.exe'
    $script:npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $script:node = (Get-Command node.exe -ErrorAction Stop).Source

    # Only this PowerShell process and its children inherit these paths.
    $env:JAVA_HOME = $resolvedJdk
    $env:ANDROID_HOME = $resolvedSdk
    $env:ANDROID_SDK_ROOT = $resolvedSdk
    $env:GRADLE_USER_HOME = Join-Path $resolvedCache 'gradle'
    $env:ANDROID_USER_HOME = Join-Path $resolvedCache 'android-user'
    $env:PATH = "$(Join-Path $resolvedJdk 'bin');$(Join-Path $resolvedSdk 'platform-tools');$env:PATH"

    if ($Persist) {
        New-Item -ItemType Directory -Path $env:GRADLE_USER_HOME, $env:ANDROID_USER_HOME, $projectCacheDir -Force | Out-Null
        @{ sdkPath = $resolvedSdk; jdkPath = $resolvedJdk; cachePath = $resolvedCache } | ConvertTo-Json |
            Set-Content -LiteralPath $configPath -Encoding UTF8
        $properties = 'sdk.dir=' + ($resolvedSdk -replace '\\', '/')
        Set-Content -LiteralPath (Join-Path $projectRoot 'android/local.properties') -Value $properties -Encoding ASCII
    }
}

function Configure-Cors {
    Invoke-Tool $node @((Join-Path $PSScriptRoot 'android-cors.mjs'))
}

function Get-DeviceSerial {
    $lines = & $adb devices -l
    if ($LASTEXITCODE -ne 0) { throw 'ADB could not list devices. Reconnect the USB cable and try again.' }
    $devices = @($lines | ForEach-Object {
        if ($_ -match '^(\S+)\s+(device|offline|unauthorized)\b') {
            [PSCustomObject]@{ serial = $Matches[1]; state = $Matches[2] }
        }
    })
    if ($Serial) {
        $selected = @($devices | Where-Object { $_.serial -eq $Serial })
        if ($selected.Count -ne 1) { throw "Device $Serial was not found. Run the Doctor action to list devices." }
        if ($selected[0].state -ne 'device') { throw "Device $Serial is $($selected[0].state). Unlock the phone and allow USB debugging, then reconnect." }
        return $selected[0].serial
    }
    $ready = @($devices | Where-Object { $_.state -eq 'device' })
    if ($ready.Count -gt 1) { throw "More than one device is connected: $($ready.serial -join ', '). Pass -Serial DEVICE_ID, or disconnect the extra devices." }
    if ($ready.Count -eq 1) { return $ready[0].serial }
    if (@($devices | Where-Object { $_.state -eq 'unauthorized' }).Count -gt 0) {
        throw 'The phone has not authorized this computer. Unlock it and tap Allow on the USB debugging authorization dialog, then run the command again.'
    }
    if ($devices.Count -gt 0) { throw 'The connected Android device is offline. Reconnect it, unlock the screen and allow USB debugging.' }
    throw 'No Android device is connected. Connect a data-capable USB cable, enable Developer options > USB debugging on the phone, and authorize this computer. See docs/ for the Android guide.'
}

function Get-BackendResponse {
    try { return Invoke-WebRequest -Uri $backendHealth -Headers @{ Origin = 'https://localhost' } -UseBasicParsing -TimeoutSec 4 }
    catch { return $null }
}

function Connect-Device([string]$DeviceSerial) {
    Configure-Cors
    $response = Get-BackendResponse
    if (-not $response) {
        Write-Host 'Starting the existing local backend and web development server...'
        & (Join-Path $PSScriptRoot 'start-local.ps1')
        $response = Get-BackendResponse
        if (-not $response) { throw 'The backend is not healthy. Start MySQL and check logs/local-backend-error.log and server/.env. No database or API credentials were changed.' }
    }
    if ($response.Headers['Access-Control-Allow-Origin'] -ne 'https://localhost' -and
        $response.Headers['Access-Control-Allow-Origin'] -ne '*') {
        throw 'Backend CORS has not picked up the Android origin. Stop the running backend and start it again with npm run server (keep MySQL running), then retry. Other running processes are left untouched.'
    }
    Invoke-Tool $adb @('-s', $DeviceSerial, 'reverse', 'tcp:3001', 'tcp:3001')
    Write-Host "USB forwarding is ready on $DeviceSerial. Keep the cable connected and the PC backend running."
}

Push-Location $projectRoot
try {
    Initialize-Toolchain ($Action -ne 'Doctor')
    switch ($Action) {
        'Doctor' {
            Write-Host "Node: $(& $node --version)"
            Write-Host "JDK: $resolvedJdk (Java $(Get-JavaMajor $resolvedJdk))"
            Write-Host "SDK: $resolvedSdk"
            Write-Host "Cache: $resolvedCache"
            Write-Host "Project cache: $projectCacheDir"
            Write-Host 'Project Gradle version: android/gradle/wrapper/gradle-wrapper.properties'
            Invoke-Tool $adb @('version')
            Invoke-Tool $adb @('devices', '-l')
            $response = Get-BackendResponse
            if ($response) {
                $allowedOrigin = $response.Headers['Access-Control-Allow-Origin']
                if ($allowedOrigin -eq 'https://localhost' -or $allowedOrigin -eq '*') {
                    Write-Host "Backend is healthy. Android CORS: $allowedOrigin"
                } else {
                    Write-Host 'Backend is healthy, but Android CORS is missing or incorrect. Run android:setup, restart the backend, and then retry android:connect.'
                }
            } else { Write-Host 'Backend is not ready on port 3001. Connect will try the existing local start script.' }
            Write-Host "APK ready: $(Test-Path -LiteralPath $apkPath) ($apkPath)"
        }
        'Setup' {
            Configure-Cors
            Write-Host "SDK: $resolvedSdk"
            Write-Host "JDK: $resolvedJdk"
            Write-Host "Cache: $resolvedCache"
            Write-Host 'Saved machine paths in .android.local.json and android/local.properties. System environment variables were not changed.'
            Write-Host 'Next: npm run android:build. No phone or Android Studio is needed to build the debug APK.'
        }
        'Build' {
            Configure-Cors
            Invoke-Tool $npm @('run', 'android:sync')
            Push-Location (Join-Path $projectRoot 'android')
            try { Invoke-Tool '.\gradlew.bat' @('assembleDebug', '--no-daemon', '--console', 'plain', '--project-cache-dir', $projectCacheDir) }
            finally { Pop-Location }
            $builtApk = Join-Path $projectRoot 'android/app/build/outputs/apk/debug/app-debug.apk'
            if (-not (Test-Path -LiteralPath $builtApk)) { throw 'Gradle finished but the expected debug APK was not found.' }
            New-Item -ItemType Directory -Path (Split-Path -Parent $apkPath) -Force | Out-Null
            Copy-Item -LiteralPath $builtApk -Destination $apkPath -Force
            Write-Host "Debug APK: $apkPath"
            Write-Host 'Connect and authorize your phone, then run npm run android:install.'
        }
        'Connect' {
            $target = Get-DeviceSerial
            Connect-Device $target
        }
        'Install' {
            if (-not (Test-Path -LiteralPath $apkPath)) { throw 'The APK has not been built yet. Run npm run android:build first.' }
            $target = Get-DeviceSerial
            Connect-Device $target
            Invoke-Tool $adb @('-s', $target, 'install', '-r', $apkPath)
            Invoke-Tool $adb @('-s', $target, 'shell', 'am', 'start', '-n', 'com.beileme.app/.MainActivity')
            Write-Host 'Beileme was installed and launched. Grant microphone permission when you choose to record.'
        }
    }
} catch {
    Write-Host "Android setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally { Pop-Location }
