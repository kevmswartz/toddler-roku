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

$ExeSource = Get-ChildItem -Path "$PWD\src-tauri\target\release\bundle" -Filter "*.exe" -Recurse | Select-Object -First 1
if (-not $ExeSource) {
    Write-Warning "No Windows executable found under src-tauri/target/release/bundle."
} else {
    Copy-Item -Path $ExeSource.FullName -Destination $ExeOutput -Force
    Write-Host "Copied desktop bundle to $ExeOutput"
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

Write-Host "Signed APK written to $ApkOutput" -ForegroundColor Green
