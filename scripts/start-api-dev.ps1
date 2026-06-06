$env:DATABASE_URL = "postgresql://cofind_user:cofind_password@localhost:5433/cofind2_dev?schema=public"
$env:API_PORT = "4000"
$env:JWT_ACCESS_SECRET = "dev-access-secret"
$env:JWT_REFRESH_SECRET = "dev-refresh-secret"
$env:MEILISEARCH_HOST = "http://localhost:7700"
$env:MEILISEARCH_MASTER_KEY = "cofind_meili_master_key"
$env:MEILI_HOST = $env:MEILISEARCH_HOST
$env:MEILI_MASTER_KEY = $env:MEILISEARCH_MASTER_KEY

$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$pnpmPath = if ($pnpmCommand) {
  $pnpmCommand.Source
} else {
  @(
    "C:\nvm4w\nodejs\pnpm.CMD",
    "$env:APPDATA\npm\pnpm.cmd",
    "C:\Program Files\nodejs\pnpm.cmd"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $pnpmPath) {
  throw "pnpm was not found. Install pnpm or run Corepack, then start the API again."
}

& $pnpmPath --filter @cofind/api dev
exit $LASTEXITCODE
