function parsePostgresMajor(version, clientName) {
  if (typeof version !== "string") {
    throw new TypeError(`${clientName} version must be a string.`);
  }

  const match = version.match(/\(PostgreSQL\)\s+(\d+)(?:\.\d+)?/i);
  if (!match) {
    throw new Error(`Could not parse ${clientName} PostgreSQL version.`);
  }

  return Number(match[1]);
}

export function assertPostgresClientCompatibility(pgDumpVersion, pgRestoreVersion) {
  const pgDumpMajor = parsePostgresMajor(pgDumpVersion, "pg_dump");
  const pgRestoreMajor = parsePostgresMajor(pgRestoreVersion, "pg_restore");

  if (pgRestoreMajor < pgDumpMajor) {
    throw new Error(`pg_restore major ${pgRestoreMajor} is older than pg_dump major ${pgDumpMajor}.`);
  }

  return { pgDumpMajor, pgRestoreMajor };
}
