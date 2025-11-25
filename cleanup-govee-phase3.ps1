# Final Govee Cleanup - Phase 3
# Removes the last remaining Govee functions and references

param([string]$FilePath = "app.js")

$content = Get-Content $FilePath -Raw

# Last batch of functions to remove
$functions = @(
    'findRegisteredGoveeDeviceByIdentifier',
    'findGoveeCloudDeviceByIdentifier',
    'testGoveeCommand',
    'normalizeGoveePowerValue',
    'refreshGoveeStatus'
)

$escapedNames = $functions | ForEach-Object { [regex]::Escape($_) }
$pattern = "(?ms)^(async\s+)?function\s+($($escapedNames -join '|'))\s*\([^)]*\)\s*\{.*?^\}"

Write-Host "Removing final $($functions.Count) Govee functions..." -ForegroundColor Yellow
$cleaned = [regex]::Replace($content, $pattern, '')

# Remove Govee discovery from discoverAndRegisterAllDevices
$goveeDiscoveryPattern = "(?ms)^\s*// Discover Govee devices.*?^\s*goveeDevices\.forEach\(registerGoveeDevice\);\s*$"
$cleaned = [regex]::Replace($cleaned, $goveeDiscoveryPattern, '', [System.Text.RegularExpressions.RegexOptions]::Multiline)

# Remove govee variables
$cleaned = $cleaned -replace "let goveeTestSelectedDevice = null;", ""
$cleaned = $cleaned -replace "let goveeTestLastCommand = null;", ""

# Remove govee event listeners
$cleaned = $cleaned -replace 'if \(document\.getElementById\(''goveeTestButtonLabel''\)\) \{[^}]+\}', ''
$cleaned = $cleaned -replace 'if \(document\.getElementById\(''goveeTestButtonEmoji''\)\) \{[^}]+\}', ''

# Remove Govee-related comments
$cleaned = $cleaned -replace '// Multi-device Govee handlers.*$', '', 'Multiline'
$cleaned= $cleaned -replace '// Testing Playground Functions\s*$', '', 'Multiline'

# Remove lightRoutine handler reference (lines 1299-1301)
$lightRoutinePattern = "(?ms)^\s*// Allow new lightRoutine configs.*?^\s*handlerName === 'lightRoutine' \u0026\u0026.*?$"
$cleaned = [regex]::Replace($cleaned, $lightRoutinePattern, '', [System.Text.RegularExpressions.RegexOptions]::Multiline)

# Clean up govee from registry
$cleaned = $cleaned -replace ', govee: \{\}', ''
$cleaned = $cleaned -replace '\bgovee: \{\}', ''
$cleaned = $cleaned -replace "govee: Object\.values\(registry\.govee \|\| \{\}\)", ''
$cleaned = $cleaned -replace "registry\.govee", 'registry.roku'
$cleaned = $cleaned -replace "\.govee\s*\|\|\s*\{\}", '.roku || {}'
$cleaned = $cleaned -replace "\+\s*allDevices\.govee\.length\s*\+\s*Govee", ''
$cleaned = $cleaned -replace "devices\.govee\.length", '0'
$cleaned = $cleaned -replace "devices\.govee", '[]'

# Remove govee: prefix replacements  
$cleaned = $cleaned -replace "normalized = normalized\.replace\(/\^govee:/i, ''\);", ''
$cleaned = $cleaned -replace "option\.value = `govee:\$\{device\.mac\}`;", ''

# Clean up empty lines
$cleaned = [regex]::Replace($cleaned, '(\r?\n){3,}', "`r`n`r`n")

Set-Content -Path $FilePath -Value $cleaned -NoNewline

$remaining = ([regex]::Matches($cleaned, "govee", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)).Count
Write-Host "✅ Phase 3 complete! Remaining 'govee' references: $remaining" -ForegroundColor Green
