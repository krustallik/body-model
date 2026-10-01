param(
  [Parameter(Mandatory = $true)][string]$Container,
  [Parameter(Mandatory = $true)][string]$User,
  [Parameter(Mandatory = $true)][string]$Backup,
  [Parameter(Mandatory = $true)][ValidateSet("nonproduction-disposable")][string]$ConfirmDisposableTarget
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$arguments = @(
  (Join-Path $PSScriptRoot "verify-postgres-restore.mjs"),
  "--container", $Container,
  "--user", $User,
  "--backup", [System.IO.Path]::GetFullPath($Backup),
  "--confirm-disposable-target", $ConfirmDisposableTarget
)

Push-Location $repoRoot
try {
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw "Disposable PostgreSQL restore verification failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
