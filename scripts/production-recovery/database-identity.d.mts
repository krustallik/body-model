export interface LogicalDatabaseIdentityInput {
  deployRootIdentity: string;
  hostTopologyIdentity: string;
  composeProjectIdentity: string;
  composeConfigurationDigest: string;
  databaseService: string;
  storageVolumeIdentity: string;
  databaseName: string;
  applicationRoleIdentity: string;
  recoveryReadOnlyRoleIdentity: string;
  backendNetworkIdentity: string;
  applicationDatabaseBindingDigest: string;
}

export function createLogicalDatabaseIdentity(identity: LogicalDatabaseIdentityInput): {
  identity: Readonly<LogicalDatabaseIdentityInput>;
  identityDigest: string;
};
