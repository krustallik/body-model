param(
  [Parameter(Mandatory = $true)][string]$Container,
  [Parameter(Mandatory = $true)][string]$Database,
  [Parameter(Mandatory = $true)][string]$User,
  [string]$Output,
  [string]$OutputDirectory = ".\backups",
  [Parameter(Mandatory = $true)][ValidateSet("read-only-production-snapshot")][string]$ConfirmProductionBackup
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$arguments = @(
  (Join-Path $PSScriptRoot "backup-postgres.mjs"),
  "--container", $Container,
  "--database", $Database,
  "--user", $User,
  "--confirm-production-backup", $ConfirmProductionBackup
)

if ($Output) {
  $arguments += @("--output", [System.IO.Path]::GetFullPath($Output))
} else {
  $arguments += @("--output-directory", [System.IO.Path]::GetFullPath($OutputDirectory))
}

Push-Location $repoRoot
try {
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw "Encrypted PostgreSQL backup failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
