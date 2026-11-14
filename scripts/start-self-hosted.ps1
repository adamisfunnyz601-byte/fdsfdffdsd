$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "NEXUS self-hosted server setup" -ForegroundColor Cyan
Write-Host "This computer must stay on and connected for the server to be reachable."

$databaseUrl = Read-Host "Paste your Neon DATABASE_URL"
if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
  throw "DATABASE_URL is required."
}
if ($databaseUrl -notmatch '^postgres(ql)?://') {
  throw "That does not look like a PostgreSQL connection string."
}

$env:DATABASE_URL = $databaseUrl
$env:PORT = "5000"

# Compatible with Windows PowerShell 5.1 and PowerShell 7.
$randomBytes = New-Object byte[] 48
$randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $randomGenerator.GetBytes($randomBytes)
  $env:SESSION_SECRET = ([BitConverter]::ToString($randomBytes) -replace '-', '').ToLowerInvariant()
}
finally {
  $randomGenerator.Dispose()
}

# tsx, TypeScript, Vite, and other build tools are devDependencies.
# Explicitly include them even if this shell previously had NODE_ENV=production.
$env:NODE_ENV = "development"
Write-Host "Installing dependencies (including build tools)..." -ForegroundColor Yellow
npm install --include=dev --registry=https://registry.npmjs.org
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

Write-Host "Building NEXUS..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw "NEXUS build failed." }

$env:NODE_ENV = "production"
Write-Host "Starting NEXUS on http://localhost:5000" -ForegroundColor Green
Write-Host "Keep this window open. Press Ctrl+C to stop the server."
npm start
