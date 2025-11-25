# Enhanced Govee Code Cleanup Script - Phase 2
# Removes ALL remaining Govee helper functions

param(
    [string]$FilePath = "app.js"
)

Write-Host "🧹 Phase 2: Removing ALL remaining Govee functions" -ForegroundColor Cyan

# Read the file
$content = Get-Content $FilePath -Raw

# ALL Govee-related function patterns (comprehensive list)
$functionsToRemove = @(
    # Storage functions
    'getStoredGoveeConfig', 'setStoredGoveeConfig',
    'getStoredGoveeApiKey', 'setStoredGoveeApiKey',
    'getStoredGoveeBrightness', 'setStoredGoveeBrightness',
    'getGoveePowerStateKey', 'getStoredGoveePowerState', 'setStoredGoveePowerState',
    'getGoveeIdentifierPowerStateKey', 'getStoredGoveeIdentifierPowerState', 'setStoredGoveeIdentifierPowerState',
    # Business logic
    'registerGoveeDevice', 'resolveGoveeOverridesFromDeviceIdentifier',
    'resolveGoveeOverridesForStep', 'resolveGoveeCloudTarget',
    'parseGoveeOverrides', 'resolveGoveeTarget', 'buildGoveeUrl',
    # UI functions  
    'setGoveeStatus', 'setGoveeCloudStatus', 'updateGoveeBrightnessLabel',
    'displayGoveeStatus', 'updateGoveeCloudUI', 'updateGoveeUI',
    'handleGoveeBrightnessInput', 'handleGoveeBrightnessChange', 'initGoveeControls',
    'humanizeGoveeCapability', 'extractGoveeDeviceCommands', 'renderGoveeCloudDevices',
    'showGoveeTestResponse',
    # Command functions
    'sendGoveeCommand', 'goveeLanCommand', 'sendGoveeCloudCommand', 'sendGoveeCloudRoutineCommand'
)

# Create regex pattern - escape function names and create pattern
$escapedNames = $functionsToRemove | ForEach-Object { [regex]::Escape($_) }
$functionPattern = "(?ms)^(async\s+)?function\s+($($escapedNames -join '|'))\s*\([^)]*\)\s*\{.*?^\}"

# Find and count matches
$matches = [regex]::Matches($content, $functionPattern)
Write-Host "Found $($matches.Count) more Govee functions to remove" -ForegroundColor Yellow

# Remove them
$cleaned = [regex]::Replace($content, $functionPattern, '')

# Remove isolated function calls
$callPatterns = @(
    '^\s*renderGoveeCloudDevices\(\);?\s*$'
    '^\s*initGoveeControls\(\);?\s*$'
    '^\s*updateGoveeUI\(\);?\s*$'
)

foreach ($pattern in $callPatterns) {
    $cleaned = [regex]::Replace($cleaned, $pattern, '', [System.Text.RegularExpressions.RegexOptions]::Multiline)
}

# Clean up empty lines
$cleaned = [regex]::Replace($cleaned, '(\r?\n){3,}', "`r`n`r`n")

# Write result
Set-Content -Path $FilePath -Value $cleaned -NoNewline

$newCount = ([regex]::Matches($cleaned, "govee", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)).Count
Write-Host "✅ Complete! Remaining 'govee' references: $newCount" -ForegroundColor Green
