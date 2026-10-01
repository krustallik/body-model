#!/usr/bin/env bash
# Write artifact references as literal Markdown; artifact names are data, never shell.

bodycast_append_encrypted_backup_summary() {
  local summary_path="$1"
  local artifact_name="$2"
  local encrypted_bytes="$3"
  {
    printf '%s\n\n' '## Encrypted off-host backup'
    printf -- '- artifact: `%s`\n' "$artifact_name"
    printf '%s\n' '- format: PostgreSQL custom archive inside authenticated AES-256-GCM envelope'
    printf -- '- size: %s bytes\n' "$encrypted_bytes"
    printf '%s\n' '- local mode: 0600' '- plaintext file on runner/production host: none'
  } >> "$summary_path"
}

bodycast_append_production_readiness_summary() {
  local summary_path="$1"
  local release_sha="$2"
  local artifact_name="$3"
  local artifact_url="$4"
  local encrypted_bytes="$5"
  {
    printf '%s\n\n' '## Production migration readiness'
    printf '%s\n' '- result: READY FOR OWNER AUTHORIZATION'
    printf -- '- release SHA: `%s`\n' "$release_sha"
    printf -- '- backup artifact: [`%s`](%s) (%s encrypted bytes; 90-day repository artifact retention)\n' \
      "$artifact_name" "$artifact_url" "$encrypted_bytes"
    printf '%s\n' '- disposable restore: verified against source migration history and baseline tables'
    printf '%s\n' '- `prisma migrate deploy`: NOT EXECUTED'
  } >> "$summary_path"
}
