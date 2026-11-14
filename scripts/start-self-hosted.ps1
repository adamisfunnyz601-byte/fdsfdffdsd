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

# Keep the signing secret stable between launches. Rotating it on every start
# invalidates every browser/app session even when the database still has it.
$sessionSecretPath = Join-Path (Get-Location) ".nexus-session-secret"
if (Test-Path $sessionSecretPath) {
  $sessionSecret = (Get-Content -Raw $sessionSecretPath).Trim()
  if ($sessionSecret.Length -lt 32) {
    throw "The saved .nexus-session-secret is invalid. Delete it and restart to generate a new one."
  }
} else {
  $randomBytes = New-Object byte[] 48
  $randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $randomGenerator.GetBytes($randomBytes)
    $sessionSecret = ([BitConverter]::ToString($randomBytes) -replace '-', '').ToLowerInvariant()
  }
  finally {
    $randomGenerator.Dispose()
  }
  [System.IO.File]::WriteAllText($sessionSecretPath, $sessionSecret, [System.Text.Encoding]::ASCII)
  Write-Host "Created a persistent session secret in .nexus-session-secret." -ForegroundColor DarkGray
}
$env:SESSION_SECRET = $sessionSecret

# tsx, TypeScript, Vite, and other build tools are devDependencies.
# Explicitly include them even if this shell previously had NODE_ENV=production.
$env:NODE_ENV = "development"
Write-Host "Installing dependencies (including build tools)..." -ForegroundColor Yellow
npm install --include=dev --registry=https://registry.npmjs.org
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

Write-Host "Synchronizing the complete NEXUS database schema with Neon..." -ForegroundColor Yellow
Write-Host "This creates missing tables and columns from shared/schema.ts. Review any proposed destructive changes carefully." -ForegroundColor DarkYellow
npm run db:push
if ($LASTEXITCODE -ne 0) { throw "Neon database schema synchronization failed. Fix the reported schema issue before starting NEXUS." }

Write-Host "Building NEXUS..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw "NEXUS build failed." }

$env:NODE_ENV = "production"
Write-Host "Starting NEXUS on http://localhost:5000" -ForegroundColor Green
Write-Host "Keep this window open. Press Ctrl+C to stop the server."
npm start
