param(
  [string]$Container = "bodycast-db-prod",
  [string]$User = "bodycast",
  [Parameter(Mandatory = $true)][string]$Backup
)

$ErrorActionPreference = "Stop"
$resolvedBackup = (Resolve-Path -LiteralPath $Backup).Path
$testDatabase = "bodycast_restore_$([guid]::NewGuid().ToString('N').Substring(0, 12))"
$containerFile = "/tmp/$testDatabase.dump"

try {
  docker cp $resolvedBackup "${Container}:${containerFile}"
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed with exit code $LASTEXITCODE" }
  docker exec $Container createdb --username=$User $testDatabase
  if ($LASTEXITCODE -ne 0) { throw "createdb failed with exit code $LASTEXITCODE" }
  docker exec $Container pg_restore --exit-on-error --no-owner --no-privileges --username=$User --dbname=$testDatabase $containerFile
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE" }
  docker exec $Container psql --username=$User --dbname=$testDatabase --tuples-only --command='SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;'
  if ($LASTEXITCODE -ne 0) { throw "Restore verification query failed with exit code $LASTEXITCODE" }
  Write-Output "Disposable restore verified in database $testDatabase"
} finally {
  docker exec $Container dropdb --if-exists --force --username=$User $testDatabase 2>$null
  docker exec $Container rm -f $containerFile 2>$null
}
