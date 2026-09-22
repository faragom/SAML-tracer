# Sign the extension for self-distribution.
#
#   .\sign.ps1
#
# Produces a signed .xpi in dist\ that installs into normal Firefox and survives
# a restart, unlike a temporary add-on loaded through about:debugging.
#
# Credentials are read from the environment and never taken as parameters. A
# parameter would end up in the PowerShell history file and in the process list;
# an environment variable set for the session does not. This script never prints
# them, and nothing writes them to disk.
#
# Get a key and secret from:
#   https://addons.mozilla.org/en-US/developers/addon/api/key/
#
# Then, in the session you are going to sign from:
#   $env:WEB_EXT_API_KEY = 'user:12345678:123'
#   $env:WEB_EXT_API_SECRET = '...'
#
# The channel is "unlisted": AMO signs the file and hands it back rather than
# publishing it. Nothing is listed publicly and no review queue is involved.
#
# What goes into the .xpi is decided by web-ext-config.cjs, not by this script.

param(
    [switch] $SkipChecks
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not $env:WEB_EXT_API_KEY -or -not $env:WEB_EXT_API_SECRET) {
    Write-Error @'
WEB_EXT_API_KEY and WEB_EXT_API_SECRET must be set in this session.

  1. Get a key and secret: https://addons.mozilla.org/en-US/developers/addon/api/key/
  2. $env:WEB_EXT_API_KEY = 'user:12345678:123'
     $env:WEB_EXT_API_SECRET = '...'
  3. .\sign.ps1

Do not pass them as arguments: they would be recorded in your PowerShell
history and visible in the process list.
'@
    exit 1
}

# manifest.json is the add-on's version, and the only one AMO sees. package.json
# carries a version of its own that upstream has let drift; it is not used here.
$manifest = Get-Content -Raw -Path 'manifest.json' | ConvertFrom-Json
$version = $manifest.version

Write-Host "Signing $($manifest.name) $version" -ForegroundColor Cyan
Write-Host ''

# lib/ is empty in the repository by design; without this the signed .xpi would ship an
# hljs-init.js whose imports resolve to nothing, and no syntax highlighting would survive.
Write-Host 'Copying third-party assets into lib/...' -ForegroundColor Cyan
npm run assets
if ($LASTEXITCODE -ne 0) { Write-Error 'Could not copy assets; nothing was signed.'; exit 1 }

if (-not $SkipChecks) {
    Write-Host 'Running tests...' -ForegroundColor Cyan
    npm test
    if ($LASTEXITCODE -ne 0) { Write-Error 'Tests failed; nothing was signed.'; exit 1 }

    Write-Host 'Linting the extension...' -ForegroundColor Cyan
    npx web-ext lint
    if ($LASTEXITCODE -ne 0) { Write-Error 'Lint failed; nothing was signed.'; exit 1 }
}

# AMO refuses a version it has already been given, so this is the most common way
# for a signing run to fail. Say it before the upload, not after.
Write-Host ''
Write-Host "About to upload version $version." -ForegroundColor Yellow
Write-Host 'If AMO has seen this version before it will refuse it.' -ForegroundColor Yellow
Write-Host 'Bump the "version" field in manifest.json first if so.' -ForegroundColor Yellow
Write-Host ''

npx web-ext sign --channel unlisted
if ($LASTEXITCODE -ne 0) {
    Write-Error 'Signing failed. Nothing was installed or published.'
    exit 1
}

Write-Host ''
Write-Host 'Signed. The .xpi is in dist\:' -ForegroundColor Green
Get-ChildItem -Path 'dist' -Filter '*.xpi' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 |
    ForEach-Object { Write-Host "  $($_.FullName)" }

Write-Host ''
Write-Host 'To install: about:addons -> the gear icon -> Install Add-on From File...'
Write-Host 'To update later: bump the version in manifest.json, then sign again.'
