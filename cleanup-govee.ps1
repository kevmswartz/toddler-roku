# Govee Code Cleanup Script
# Removes all Govee/lights/BLE related functions and references from app.js

param(
    [string]$FilePath = "app.js",
    [switch]$DryRun = $false
)

Write-Host "🧹 Govee Code Cleanup Script" -ForegroundColor Cyan
Write-Host "File: $FilePath" -ForegroundColor Yellow
Write-Host ""

# Read the file
$content = Get-Content $FilePath -Raw

# Define patterns to remove
$functionsToRemove = @(
    # Govee functions
    'govee\w+',
    # Light functions
    'renderLightsButtons',
    'lightRoutine',
    # BLE functions  
    'scanBluetoothLE',
    'scanBluetoothDevices',
    'saveDeviceListToCloud'
)

# Create a regex pattern to match function definitions
$functionPattern = @"
(?ms)^(async\s+)?function\s+($($functionsToRemove -join '|'))\s*\([^)]*\)\s*\{.*?^\}
"@

# Find all matches
$matches = [regex]::Matches($content, $functionPattern)

Write-Host "Found $($matches.Count) function definitions to remove:" -ForegroundColor Green
foreach ($match in $matches) {
    $funcName = $match.Groups[2].Value
    $lineStart = ($content.Substring(0, $match.Index) -split "`n").Count
    Write-Host "  - $funcName (around line $lineStart)" -ForegroundColor Gray
}

if ($DryRun) {
    Write-Host "`n✅ Dry run complete. Use without -DryRun to apply changes." -ForegroundColor Yellow
    exit 0
}

# Remove the functions
$cleaned = [regex]::Replace($content, $functionPattern, '')

# Additional cleanup: Remove Govee-related variable references
$patterns = @{
    # Remove goveeApiKey handling in applyToddlerContent
    'goveeApiKey handling' = '(?ms)if \(Object\.prototype\.hasOwnProperty\.call\(settingsData, ''goveeApiKey''\)\) \{.*?^\s+\}'
    # Remove initGoveeControls call
    'initGoveeControls call' = '^\s*initGoveeControls\(\);?\s*$'
    # Remove renderLightsButtons calls
    'renderLightsButtons calls' = '^\s*renderLightsButtons\([^)]*\);?\s*$'
}

foreach ($name in $patterns.Keys) {
    $pattern = $patterns[$name]
    $beforeCount = ([regex]::Matches($cleaned, $pattern)).Count
    $cleaned = [regex]::Replace($cleaned, $pattern, '', [System.Text.RegularExpressions.RegexOptions]::Multiline)
    Write-Host "Removed $beforeCount instance(s) of: $name" -ForegroundColor Gray
}

# Clean up multiple blank lines (more than 2 consecutive)
$cleaned = [regex]::Replace($cleaned, '(\r?\n){3,}', "`r`n`r`n")

# Backup original
$backupPath = "$FilePath.backup"
Copy-Item $FilePath $backupPath -Force
Write-Host "`n💾 Backup created: $backupPath" -ForegroundColor Green

# Write cleaned content
Set-Content -Path $FilePath -Value $cleaned -NoNewline
Write-Host "✅ Cleaned file saved: $FilePath" -ForegroundColor Green

# Show summary
$originalLines = (Get-Content "$FilePath.backup").Count
$newLines = (Get-Content $FilePath).Count  
$removed = $originalLines - $newLines

Write-Host "`n📊 Summary:" -ForegroundColor Cyan
Write-Host "  Original: $originalLines lines" -ForegroundColor Gray
Write-Host "  New: $newLines lines" -ForegroundColor Gray
Write-Host "  Removed: $removed lines" -ForegroundColor Green
