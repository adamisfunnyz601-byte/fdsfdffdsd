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
$env:NODE_ENV = "production"
$env:PORT = "5000"
$env:SESSION_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))

Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

Write-Host "Building NEXUS..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw "NEXUS build failed." }

Write-Host "Starting NEXUS on http://localhost:5000" -ForegroundColor Green
Write-Host "Keep this window open. Press Ctrl+C to stop the server."
npm start
