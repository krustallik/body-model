param(
  [string]$Container = "bodycast-db-prod",
  [string]$Database = "bodycast",
  [string]$User = "bodycast",
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = "Stop"
$resolvedOutput = [System.IO.Path]::GetFullPath($Output)
$containerFile = "/tmp/bodycast-backup-$([guid]::NewGuid().ToString('N')).dump"

try {
  docker exec $Container pg_dump --format=custom --no-owner --no-privileges --username=$User --dbname=$Database --file=$containerFile
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }
  docker cp "${Container}:${containerFile}" $resolvedOutput
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed with exit code $LASTEXITCODE" }
  $backup = Get-Item -LiteralPath $resolvedOutput
  if ($backup.Length -le 0) { throw "Backup is empty" }
  Write-Output "Backup verified: $($backup.FullName) ($($backup.Length) bytes)"
} finally {
  docker exec $Container rm -f $containerFile 2>$null
}
