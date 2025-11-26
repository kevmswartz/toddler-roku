param(
    [string]$KeystorePath = "$PWD\roku-control.keystore",
    [string]$KeyAlias = "rokuControl",
    [string]$ApkOutput = "$PWD\app-release-signed.apk",
    [string]$ExeOutput = "$PWD\roku-control.exe",
    [string]$BuildToolsVersion = "34.0.0",
    [string]$AndroidTargets = "aarch64"
)

$ErrorActionPreference = 'Stop'

function Invoke-CommandChecked {
    param(
        [Parameter(Mandatory)] [string]$Command,
        [string[]]$Arguments = @(),
        [string]$WorkDir
    )

    $startingLocation = Get-Location
    if ($WorkDir) {
        Set-Location -LiteralPath $WorkDir
    }

    try {
        & $Command @Arguments
        $exitCode = $LASTEXITCODE
    } finally {
        Set-Location -LiteralPath $startingLocation
    }

    if ($exitCode -ne 0) {
        $argString = $Arguments -join ' '
        throw "Command '$Command $argString' failed with exit code $exitCode."
    }
}

Write-Host "Building desktop release..." -ForegroundColor Cyan
Invoke-CommandChecked -Command "npm" -Arguments @("run", "tauri:build") -WorkDir "$PWD"

$RawExe = Join-Path $PWD "src-tauri\target\release\roku-control-app.exe"
if (Test-Path $RawExe) {
    Copy-Item -Path $RawExe -Destination $ExeOutput -Force
    Write-Host "Copied native executable to $ExeOutput"
} else {
    $ExeSource = Get-ChildItem -Path "$PWD\src-tauri\target\release\bundle" -Filter "*.exe" -Recurse | Select-Object -First 1
    if (-not $ExeSource) {
        Write-Warning "No Windows executable found under src-tauri/target/release/. Skipping EXE copy."
    } else {
        Copy-Item -Path $ExeSource.FullName -Destination $ExeOutput -Force
        Write-Host "Copied packaged executable to $ExeOutput"
    }
}

Write-Host "Building Android release (unsigned)..." -ForegroundColor Cyan
[Environment]::SetEnvironmentVariable("TAURI_SKIP_VERSION_CHECK", "1", "Process")
$targets = ($AndroidTargets -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
$targetArgs = @("tauri", "android", "build")
if ($targets.Count -gt 0) {
    $targetArgs += @("--target")
    $targetArgs += $targets
}
Invoke-CommandChecked -Command "npx" -Arguments $targetArgs -WorkDir "$PWD"

$UnsignedApk = Get-ChildItem -Path "$PWD\src-tauri\gen\android\app\build\outputs\apk" -Filter "*-unsigned.apk" -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $UnsignedApk) {
    throw "Unable to locate an unsigned APK in outputs/apk/."
}

if (-not (Test-Path $KeystorePath)) {
    throw "Keystore not found at $KeystorePath."
}

$ApkSigner = Join-Path $Env:ANDROID_HOME "build-tools\$BuildToolsVersion\apksigner.bat"
if (-not (Test-Path $ApkSigner)) {
    throw "apksigner not found at $ApkSigner. Adjust build-tools version or pass -BuildToolsVersion."
}

Write-Host "Signing APK..." -ForegroundColor Cyan
Invoke-CommandChecked -Command $ApkSigner -Arguments @(
    "sign",
    "--ks", $KeystorePath,
    "--ks-key-alias", $KeyAlias,
    "--out", $ApkOutput,
    $UnsignedApk.FullName
) -WorkDir "$PWD"

if (Test-Path "$ApkOutput.idsig") {
    Remove-Item "$ApkOutput.idsig" -Force -ErrorAction SilentlyContinue
}

Write-Host "Signed APK written to $ApkOutput" -ForegroundColor Green

# Copy artifacts to netlify folder for distribution
$NetlifyDir = Join-Path $PWD "netlify\public\downloads"
if (-not (Test-Path $NetlifyDir)) {
    New-Item -ItemType Directory -Path $NetlifyDir -Force | Out-Null
}

$NetlifyCopies = @()

if (Test-Path $ExeOutput) {
    $ExeDest = Join-Path $NetlifyDir (Split-Path $ExeOutput -Leaf)
    Copy-Item -Path $ExeOutput -Destination $ExeDest -Force
    Write-Host "Copied EXE to netlify: $ExeDest" -ForegroundColor Cyan
    $NetlifyCopies += @{Name = (Split-Path $ExeOutput -Leaf); Type = "Windows"; Size = (Get-Item $ExeDest).Length }
}

if (Test-Path $ApkOutput) {
    $ApkDest = Join-Path $NetlifyDir (Split-Path $ApkOutput -Leaf)
    Copy-Item -Path $ApkOutput -Destination $ApkDest -Force
    Write-Host "Copied APK to netlify: $ApkDest" -ForegroundColor Cyan
    $NetlifyCopies += @{Name = (Split-Path $ApkOutput -Leaf); Type = "Android"; Size = (Get-Item $ApkDest).Length }
}

# Generate download page
$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$DownloadHtml = @"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Roku Control - Download Latest Build</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: #0f172a; color: #e2e8f0; }
        h1 { color: #60a5fa; }
        .download-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin: 20px 0; }
        .download-btn { background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block; margin: 10px 10px 0 0; font-weight: 600; }
        .download-btn:hover { background: #2563eb; }
        .meta { color: #94a3b8; font-size: 0.9em; margin-top: 10px; }
        .file-size { color: #cbd5e1; }
    </style>
</head>
<body>
    <h1>📥 Roku Control - Latest Build</h1>
    <p>Built on: <strong>$Timestamp</strong></p>
"@

foreach ($file in $NetlifyCopies) {
    $SizeMB = [math]::Round($file.Size / 1MB, 2)
    $DownloadHtml += @"
    
    <div class="download-card">
        <h3>$($file.Type) App</h3>
        <a href="/downloads/$($file.Name)" class="download-btn">⬇️ Download $($file.Name)</a>
        <div class="meta">
            <span class="file-size">Size: ${SizeMB} MB</span>
        </div>
    </div>
"@
}

$DownloadHtml += @"

</body>
</html>
"@

$DownloadPagePath = Join-Path (Join-Path $PWD "netlify\public") "downloads.html"
$DownloadHtml | Out-File -FilePath $DownloadPagePath -Encoding UTF8
Write-Host "`n✅ Download page created: $DownloadPagePath" -ForegroundColor Green
Write-Host "   Deploy the netlify folder to access downloads at: https://your-site.netlify.app/downloads.html" -ForegroundColor Cyan

