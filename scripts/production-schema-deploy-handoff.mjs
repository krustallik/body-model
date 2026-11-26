import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { link, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AUTH_MULTIUSER_MANIFEST, DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST, TRAINING_MUTATION_LEDGER_MANIFEST, TRAINING_SESSION_CONTEXT_MANIFEST } from "./production-migration-manifests.mjs";
import { evaluateProductionPostflight, schemaInventoryDigest } from "./production-migration-preflight.mjs";
import { PROGRAMLESS_STRENGTH_SESSIONS_CAPABILITY, readProductionAppCapabilitiesAtSha } from "./production-app-capabilities.mjs";

export const AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA = "18e67d53856af1f4742bbe9626abbd005b70e8bf";
export const AUTH_MULTIUSER_MIGRATION_WORKFLOW_RUN_ID = "41545707543";
export const AUTH_MULTIUSER_MIGRATION_CI_RUN_ID = "41542857004";
export const AUTH_MULTIUSER_MIGRATION_ACTOR_ID = "126446430";
export const SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA = "62b6961dde7036100c8af7281e7bfab75bb662db";
export const V4_REPUBLICATION_MIGRATION_ORIGIN_SHA = "8b4a195e8afb67c0a913d0175a030e01cc665732";
export const SCHEMA_DEPLOY_HANDOFF_PROVENANCE = Object.freeze({
  manifestId: "active-energy-unified-v2",
  workflowRunId: "38069108209",
  workflowRunAttempt: 1,
  authorizationId: "123dcfca-64a4-4708-8c3a-3a9f59ed5412",
  lineageDigest: "877d195c9600f760d821eeb8f6f770e307292671a94e549e46dca8c344ee3e2e",
  spawnState: "started",
});
export const V4_REPUBLICATION_HANDOFF_PROVENANCE = Object.freeze({
  manifestId: "unified-v4-republication-v1",
  workflowRunId: "38447647403",
  workflowRunAttempt: 1,
  authorizationId: "4c990873-d8d1-492b-a73d-ca36823e6b79",
  lineageDigest: "ccf2a37b8f255337760cb2156385bac434650fba70af32fe9fc73c0b8e414768",
  spawnState: "started",
});

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const V4_REPUBLICATION_MANIFEST_ID = "unified-v4-republication-v1";
const AUTH_MULTIUSER_MANIFEST_ID = AUTH_MULTIUSER_MANIFEST.id;
const DYNAMIC_WORKOUT_MANIFEST_ID = DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id;
const TRAINING_MUTATION_LEDGER_MANIFEST_ID = TRAINING_MUTATION_LEDGER_MANIFEST.id;
const TRAINING_SESSION_CONTEXT_MANIFEST_ID = TRAINING_SESSION_CONTEXT_MANIFEST.id;
const DYNAMIC_WORKOUT_NON_RUNTIME_PATH = /^(?:tests\/|docs\/development\/)/;
const AUTH_MULTIUSER_NON_RUNTIME_PATH = /^(?:tests\/|research\/|docs\/research\/|scripts\/production-schema-deploy-handoff\.mjs$)/;
const V3_STATES = new Set(["schema-applied", "app-ready", "v4-ready", "database-restored", "rollback-app-ready"]);
const DENIED_PATH = /^(?:prisma\/|public\/|scripts\/unified-v[34]|scripts\/physiology|docker-compose(?:\.prod)?\.yml$|package(?:-lock)?\.json$|next\.config\.[^/]+$|tsconfig(?:\.[^/]+)?\.json$)/;
const ALLOWED_PATH = /^(?:\.github\/workflows\/|tests\/|scripts\/production-release-marker\.(?:sh|mjs)$|scripts\/production-schema-deploy-handoff\.mjs$|scripts\/production-traffic-cutover\.sh$|scripts\/production-full-history-recalculate\.ts$|src\/app\/api\/forecast\/(?:action\/)?route\.ts$|src\/app\/api\/v1\/model\/recalculate\/route\.ts$|src\/lib\/logger\.ts$|src\/modules\/model-episodes\/(?:full-history-recalculation\.service|transient-exercise-water-episode-time-v2)\.ts$|src\/modules\/training\/experimental-transient-exercise-water-shadow\.service\.ts$|Dockerfile$)/;
const V4_UNBOUND_NON_RUNTIME_PATH = /^(?:tests\/|scripts\/(?:production-schema-deploy-handoff|github-no-app-preflight-evidence)\.mjs$|scripts\/production-v4-fingerprint-forensics\.(?:mjs|d\.mts)$)/;
const V4_RETIRED_WORKFLOW_PATH = ".github/workflows/activate-unified-v4-production.yml";
/** Exact audited Git blobs admitted for this deploy-only compatibility handoff. */
const CONTENT_BOUND_PATHS = Object.freeze({
  "docs/development/production-deploy.md": Object.freeze({
    migrationOriginBlob: "6096de9b780800654046c63c369643a310d5bb56",
    deployBlob: "b1a26cce30fb69fddde0d9fe81dd3bc26e342678",
  }),
  "scripts/ci/production-deploy-gate.ts": Object.freeze({
    migrationOriginBlob: "8d0d5e1d0a7c291daae0ff9cd6a970cfb3085083",
    deployBlob: "451319d5792e92fac02757ad8396c531ad5f19bb",
  }),
  "scripts/production-route-primitives.sh": Object.freeze({
    migrationOriginBlob: "65a51f97bf404d9353b45b1fc33725cb7a582daa",
    deployBlob: "001b5a5de48a17db06ab7e61731b184a3c82dc83",
  }),
  "scripts/deploy.sh": Object.freeze({
    migrationOriginBlob: "14e4caa5645ce8b95c16ecc03b3937bd0e60a1e3",
    deployBlob: "4844bdc0b586f29dbc3b60952717e249a04bbbbc",
  }),
  "scripts/production-app-container-health-wait.sh": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "b99a87d861d5471336bd0d75f4df49436237df7c",
  }),
  "scripts/production-checkout-diagnostic.sh": Object.freeze({
    migrationOriginBlob: "f19687c65d7e9d3b744890f377ebf6f0c80eebf9",
    deployBlob: "7256cf45844deade0685f82eb470bf79a396c497",
  }),
});
/** Exact executable blobs reviewed for the V4 app-ready migration-origin handoff. */
const V4_CONTENT_BOUND_PATHS = Object.freeze({
  "src/modules/activity/active-energy-materialization.ts": Object.freeze({
    migrationOriginBlob: "ec066afe744ec0de47f8c5503266764eff311608",
    deployBlob: "f163d3116638e44a6e42e10fac261f57acd11579",
  }),
  "src/modules/activity/active-energy-publication.ts": Object.freeze({
    migrationOriginBlob: "3c1fcfec0ca73ac6b599ae6a7527c067b77adb2f",
    deployBlob: "b76617954f03b700d7a783aa2f30a11388b769c9",
  }),
  "src/modules/health/health.repository.ts": Object.freeze({
    migrationOriginBlob: "a8040b6f8a0eede730c67ba1a4df90063570bc13",
    deployBlob: "e9e2b342d3c26cb64f28ff9f19b136bbe9b557af",
  }),
  ".github/workflows/production-migration-preflight.yml": Object.freeze({
    migrationOriginBlob: "02a0a107c004dfd169363a1ac98abceb9e1674d0",
    deployBlob: "b66ed02fae2efb86dc540ff7a3809bc93ee85a6b",
  }),
  ".github/workflows/production-migration-safety-ci.yml": Object.freeze({
    migrationOriginBlob: "38c58d25e8cb3a0aa389b4003c252a64481e584d",
    deployBlob: "c07c2785d8f60993f63d7b779135d9d628834077",
  }),
  "src/app/api/forecast/action/route.ts": Object.freeze({
    migrationOriginBlob: "f50deac8061cff227dba477182472e44ddff4090",
    deployBlob: "73c6c1f6d0edd4b6ae3b7c82fdef73419b36c219",
  }),
  "src/modules/model-forecast/forecast-ui.ts": Object.freeze({
    migrationOriginBlob: "5d4faf2fd247f2abcc0d5889ba03917d4e2ace70",
    deployBlob: "cfc853f1aeb319e0acc9910025573336478d7496",
  }),
  "src/app/api/forecast/route.ts": Object.freeze({
    migrationOriginBlob: "266d7f80a79f298e413d1153685083d2b3dfe84a",
    deployBlob: "a629fb980be4dbc00209536b54882432759f916e",
  }),
  "src/app/api/v1/model/recalculate/route.ts": Object.freeze({
    migrationOriginBlob: "132d6eb4822d40d8698a17b1586a06cb77573e7d",
    deployBlob: "dd6e997d42043d8acf93c59f485b4224cea359ea",
  }),
  "src/lib/logger.ts": Object.freeze({
    migrationOriginBlob: "0b4e09be4aa48424027e229e14bbb090624881bf",
    deployBlob: "fdaccd1cd0c526a4b1b1415002bd09ea27ec7f5a",
  }),
  "docs/development/production-deploy.md": Object.freeze({
    migrationOriginBlob: "b1a26cce30fb69fddde0d9fe81dd3bc26e342678",
    deployBlob: "15ed255f4cf38799807a84cb5b4d231269552fdf",
  }),
  ".github/workflows/deploy-production.yml": Object.freeze({
    migrationOriginBlob: "1be0ba2dc8fcfe2c34a97b39ae1d5d0fde32404f",
    deployBlob: "b4955059fc3cae0d94abbd2656c99b51800caad7",
  }),
  "scripts/ci/production-safety-postgres-smoke.mjs": Object.freeze({
    migrationOriginBlob: "1a0345e687fd3f604499502bdf98a07b606da07f",
    deployBlob: "7b973c5a5469393b5d23ba298041ef6d3933c036",
  }),
  "scripts/deploy.sh": Object.freeze({
    migrationOriginBlob: "4844bdc0b586f29dbc3b60952717e249a04bbbbc",
    deployBlob: "b3c119c2442d11361612228122718351d36beff4",
  }),
  "src/modules/health/health.service.ts": Object.freeze({
    migrationOriginBlob: "17a2e1c47b2b7fe1d0d7b968b9e91fffc51a8431",
    deployBlob: "089e266f3664b4aabe268888e6ac3a233d2d0515",
  }),
  "src/modules/model-episodes/experimental-glycogen-state-shadow.service.ts": Object.freeze({
    migrationOriginBlob: "0e61b01275a1905710adc1d7721db006596459b0",
    deployBlob: "8a2aa5e38d4ad224e862a271a3fa69d655ff0e9a",
  }),
  "src/modules/model-episodes/model-episode.service.ts": Object.freeze({
    migrationOriginBlob: "0d32af00d8fa7bf4228cb87c434d85492b430d82",
    deployBlob: "0c26958724115a8af43081cb127350213ece1488",
  }),
  "src/modules/model-episodes/physiology-v7-persistence.repository.ts": Object.freeze({
    migrationOriginBlob: "07e75f6a1393cdb8cae8f9c593575930a124d394",
    deployBlob: "931fafdc488b460a080588ec7b981f08befd537f",
  }),
  "src/modules/profile/experimental-stepper-active-energy-shadow.service.ts": Object.freeze({
    migrationOriginBlob: "b4ec529a9755c9a3b15ea2b6c9ba19216bd6e888",
    deployBlob: "5244ce9f1d1092a881776232128464d8d6705127",
  }),
  "src/modules/training/experimental-strength-energy-shadow.service.ts": Object.freeze({
    migrationOriginBlob: "2f556ff6817db3dff23a09d0ff15ba8254543551",
    deployBlob: "4e9f5da57b7b60c0c553c35f62c12d994c9f9126",
  }),
  "src/modules/training/training.service.ts": Object.freeze({
    migrationOriginBlob: "d036d589304338b07d43c1b1eebb8314910b3acb",
    deployBlob: "408efc5996e9ad701057ab7f261d0cb045541ff4",
  }),
  "scripts/production-db-data-fingerprint.sh": Object.freeze({
    migrationOriginBlob: "101ecf34dc5751fc431a5b88f787d7ebc3e98fde",
    deployBlob: "fff493643ecb171049893ecfc935773a4bcdaac5",
  }),
  "scripts/production-release-marker.sh": Object.freeze({
    migrationOriginBlob: "40bdb77377cfe02ce8bedd9760d82f21befc128e",
    deployBlob: "4a625b3599946405dac0fe0276d375e12283c22c",
  }),
  "scripts/production-v4-post-ddl-backup-host.sh": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "76782d626c633a37c3de2330a6ef1d58df67d0d0",
  }),
  "scripts/production-migration-preflight.mjs": Object.freeze({
    migrationOriginBlob: "1f83a82cff68b3b9bbf3669156ae15be2f0e4a9b",
    deployBlob: "dfb007dfde094aa359dc0c5f0260b820e1a908de",
  }),
  "scripts/production-v4-recovery.mjs": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "af8e2e03ddac71d710f191ec2f221b31c3785a76",
  }),
  "scripts/production-writer-drain.mjs": Object.freeze({
    migrationOriginBlob: "f2e275e64e52089ac88351a695b2aad2d427e343",
    deployBlob: "19bce9311aa836b0347b832dc7d4042b1d26bd96",
  }),
  "scripts/production-traffic-cutover.sh": Object.freeze({
    migrationOriginBlob: "baeb3ff34c52c606a653d9e0c027c79d7b7c72da",
    deployBlob: Object.freeze([
      "7b1d61f367d1b2e909fe435d50a5cdcdc736247f",
      "31631c8dce4ef102f7e7a60e147f5abd71f4b4ff",
    ]),
  }),
  "scripts/unified-v4-activate-replay.ts": Object.freeze({
    migrationOriginBlob: "2bb3f1130241dcc0e354e70a60f5284452849a12",
    deployBlob: "c61af4cc64a6a4e7ed2b74315310d79d8b40f050",
  }),
  "src/modules/model-episodes/unified-rollout-v4.service.ts": Object.freeze({
    migrationOriginBlob: "2532cef483cb8bdec332cc22782a30d2a0ba178b",
    deployBlob: "d5b445b418a1c24637c6439d14938c661f48a619",
  }),
  "src/modules/model-episodes/unified-experimental-physiology-state.service.ts": Object.freeze({
    migrationOriginBlob: "0c7850cbb866f62d20a4a35ab384f18906a67ef8",
    deployBlob: "d0f9f7ef0be1f0b0f4ad3efb1abbcac538f8b191",
  }),
  "src/modules/training/experimental-transient-exercise-water-shadow.service.ts": Object.freeze({
    migrationOriginBlob: "4291768358207464a59476a75e3897e5a85f9332",
    deployBlob: "8547fdaa05b721c4dcd578c2b1c096a53e52c729",
  }),
});
/** Schema/runtime identity that must remain identical to the migration origin. */
const CRITICAL_TREES = ["prisma"];
const CRITICAL_FILES = ["docker-compose.prod.yml", "package.json", "package-lock.json"];
const AUTH_MULTIUSER_CRITICAL_TREES = Object.freeze(["prisma"]);
const AUTH_MULTIUSER_CRITICAL_FILES = Object.freeze([...CRITICAL_FILES, "Dockerfile"]);
export const AUTH_MULTIUSER_CONTENT_BOUND_PATHS = Object.freeze({
  Dockerfile: Object.freeze({
    migrationOriginBlob: "2dc903fcaff366e932064b7f52f26773fd942b38",
    deployBlob: "e4b835ff3a2de07219941c4c57e7c43aa63edf7c",
  }),
  "src/modules/health/normalize-shortcut-numeric-values.ts": Object.freeze({
    migrationOriginBlob: "21d794a84044655b88a6f2eeb0a2d72ff5ce9b1e",
    deployBlob: "f3cdcb33d6496b0b7f7036ea9dde7001331c5299",
  }),
  ".github/workflows/deploy-production.yml": Object.freeze({
    migrationOriginBlob: "252f5c6797f961dddeab4a0d758c7d35610271f8",
    deployBlob: Object.freeze([
      "df94bdd1e86dba85d7b37875e10f9af1496b2601",
      "905a5a24753119dd1263e523c996354465789591",
      "8bafe564ba68b2f90814f15025120405c6ae300b",
    ]),
  }),
  "src/app/api/registration/password-setup/route.ts": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "76f686a89f2ff9caf5c2aca2cdb414d4fe37b52e",
  }),
  "src/app/api/registration/resend/route.ts": Object.freeze({
    migrationOriginBlob: "6c352fc4983b9f15d955dfda5647905af29b2fcb",
    deployBlob: "fb88885e93ca29f21b84ad2a87f81dfff91d34a0",
  }),
  "src/app/api/registration/start/route.ts": Object.freeze({
    migrationOriginBlob: "774849f9e96522fbc838dfd3651f6391d3e2e90f",
    deployBlob: "81d1b92594672ce62ea3eb4d421012e6d700bd4c",
  }),
  "src/app/auth-flow.tsx": Object.freeze({
    migrationOriginBlob: "a94d77373434b1d4ef3c35ee47a2445ecd3ad8fb",
    deployBlob: Object.freeze([
      "d4841a8265496fae056f906fb99199089bab7dc5",
      "baf559384fbafcf1ccc92cc817f682d4f5934f95",
    ]),
  }),
  "src/app/auth.module.css": Object.freeze({
    migrationOriginBlob: "d6e8e825e6d50fb26e888f439aacf5d23ffa20c1",
    deployBlob: "8a9e166e988ddd1fa477f1152b8f7e626f9a2731",
  }),
  "src/i18n/i18n-provider.tsx": Object.freeze({
    migrationOriginBlob: "1c56ca6a7c24df91da54f502e14785adb6a52634",
    deployBlob: "7a593f817f9da79d974b6ac03f14ebe12b51547b",
  }),
  "src/app/login/page.tsx": Object.freeze({
    migrationOriginBlob: "83a9e6107a68e17b163b4a954a7226fb9f93fd6d",
    deployBlob: Object.freeze([
      "6af4eb87d58d93515fa485f85003a9bf31de996d",
      "2a4908e39ce1b808be5ba9eef6254054b4987caa",
    ]),
  }),
  "src/app/settings/profile/page.tsx": Object.freeze({
    migrationOriginBlob: "10ea5d494935371ce8d30496c87ffb1907da22e0",
    deployBlob: Object.freeze([
      "556d6f9ce00c786804c6a24c43e646e6e421ffde",
      "5bb4e015c0b87791d71669ff3327ce19a8175c43",
    ]),
  }),
  "src/app/settings/profile/profile-client.tsx": Object.freeze({
    migrationOriginBlob: "47eacddc1ec3d7ee9f5e73cb655ef9243eef39cf",
    deployBlob: Object.freeze([
      "ac8909279dd69f220457e7016578fe5a6ef4f969",
      "8fd45683daed08578c76c225aaa3129b4b4b1de4",
    ]),
  }),
  "src/app/settings/profile/profile.module.css": Object.freeze({
    migrationOriginBlob: "0d56843afe2879f5bdb7fc55984c79091760a546",
    deployBlob: Object.freeze([
      "37887c270039f6354bc1aff08d5851cba2fdad12",
      "7772aa1cea23764f754d3ff00f7e481f24327024",
    ]),
  }),
  "src/app/training/exercise-images.ts": Object.freeze({
    migrationOriginBlob: "f7e8a57cb8e331b6f1fb4eabc36012de16f480f1",
    deployBlob: Object.freeze([
      "758e27fce4a5b645870d0fa42478211f7c35ee21",
      "fa64117cdf86a80590b45fd17a39c4dd6f54545d",
      "3c79724636bd2630b78c9544efe7f92c7d94c03a",
      "8ce0b61e949ca18a1b914f9ccaadbbc9a84242a5",
      "666d34618ec1ec5010e7ba3d44533cf9a7968786",
    ]),
  }),
  "src/app/training/training-exercise-pane.tsx": Object.freeze({
    migrationOriginBlob: "ab90d59ad0c5922caa19e6e0ae591dc04cbc6870",
    deployBlob: Object.freeze([
      "6c6bcf9b29cf98309092814a23c0708e67a90802",
      "d4bd39c6a35f44a0d08668e11ee77cf1d6573734",
      "c9cbe4e5813af800cf495f37d55a75034884844b",
      "5e3b17f7fd2bc33238d6dae9eb7abea6d1b8c101",
    ]),
  }),
  "src/app/register/page.tsx": Object.freeze({
    migrationOriginBlob: "8cdf4ac669863efb0bace4ca4de5d88361573b12",
    deployBlob: "7d8080640c95abfb26ee9a447ca365eef84ca552",
  }),
  "src/lib/auth.ts": Object.freeze({
    migrationOriginBlob: "0d0a733b2ff30c09a8277bc83809faeb6920ad61",
    deployBlob: Object.freeze([
      "cf400f4040db655e4dd127f0821968cd098c3608",
      "94a010a9e5ba24c876b6f934272dccb48ff6f45b",
      "b044300d509fce08a5094bb2a1b382dc1a26aed2",
    ]),
  }),
  "src/modules/auth/policy.ts": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "f92e8b18e493dbdfe16c81275f56eccadb57608c",
  }),
  "src/modules/auth/registration-users.ts": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "f3d70949fda81052014235d27f1cf88c79f02493",
  }),
  "scripts/unified-v4-traffic-check.ts": Object.freeze({
    migrationOriginBlob: "109395c697f53934123e73c75920be6cd58ea447",
    deployBlob: Object.freeze([
      "f26b76f5fa49f4f6a0e578a315743f926b89a397",
      "43e455b797bdcf81bcb625800af819c0845fcd4a",
    ]),
  }),
  "README.md": Object.freeze({
    migrationOriginBlob: "aa8edb763d217c0f8791c6f630f700d04fb42295",
    deployBlob: "63c696a7d6699edec9c743c1c9fe8cb5cce99cbf",
  }),
  "src/app/diagnostics/diagnostics-client.tsx": Object.freeze({
    migrationOriginBlob: "d5e47a040fb9b873281d335866023486328f8be5",
    deployBlob: "ca0bdbb6c4eea2add6582d3b8c2efb41a49d6150",
  }),
  "src/app/diagnostics/diagnostics.module.css": Object.freeze({
    migrationOriginBlob: "3c124754a0379a38189f0c533f04b9672a11d8b7",
    deployBlob: "48e7987fe31ce7adf39dabbdd625d0eca4dbcba2",
  }),
  "src/app/forecast/forecast-client.tsx": Object.freeze({
    migrationOriginBlob: "05387123abbe85b433242789bdf0e715ef9fc1c8",
    deployBlob: "34d165e767d877e8ce793eb2862054918984c002",
  }),
  "src/app/forecast/forecast.module.css": Object.freeze({
    migrationOriginBlob: "f5d14b15ac35a3928e91e2c77ed20f9d3a2fcf7a",
    deployBlob: "5e00559bbd9404cc2e52f43c2cbda43e8ffc673e",
  }),
  "src/app/goal/goal-client.tsx": Object.freeze({
    migrationOriginBlob: "426d261b324ca1d9f6aaa7ae0496c506a1d4a326",
    deployBlob: "cc702dd843c18eb7453f94f7e7063e4036932e66",
  }),
  "src/app/goal/goal.module.css": Object.freeze({
    migrationOriginBlob: "6b2488d5f52ba70ba5f76ea750923427a07549c8",
    deployBlob: "4f0099b54b9759c26b14520e30592d05c89a8ca0",
  }),
  "src/components/app-nav.module.css": Object.freeze({
    migrationOriginBlob: "24a27d85cd28ad79bd55443d9ba4e35318b67d94",
    deployBlob: "259f6182e76ff6fbf299100c330ea755f09e71c1",
  }),
  "src/modules/model-diagnostics/model-diagnostics.repository.ts": Object.freeze({
    migrationOriginBlob: "efd71caef3bd542d78f48ae3b3d6855c9a816408",
    deployBlob: "f48e4ec4cb494e260770c4718e8ab05b803548c0",
  }),
  "src/modules/model-diagnostics/model-diagnostics.service.ts": Object.freeze({
    migrationOriginBlob: "0d8c97651ac1abfc5106cc7e4910757102fdb79a",
    deployBlob: "da7f7b9813893b7e28cc50c19b837acf80a2f62f",
  }),
  "src/modules/model-diagnostics/model-diagnostics.ts": Object.freeze({
    migrationOriginBlob: "1ce3580714046eb0d503e3234e1df7418758fdf2",
    deployBlob: "f314105458a6c8d984159027274472d6fd116a5a",
  }),
  "src/modules/model-diagnostics/model-diagnostics.types.ts": Object.freeze({
    migrationOriginBlob: "1987ca98b62dcd0ae070ba0355a05b7624927297",
    deployBlob: "98e301aa627c3d268679dcef8b8fa26d867b4ca9",
  }),
  "src/modules/model-forecast/forecast-ui.ts": Object.freeze({
    migrationOriginBlob: "f3677f8381df1730324916acea663994954c0c85",
    deployBlob: "05d3bac7928921d6d4fe90f806a02d3da03b8c81",
  }),
  "docs/architecture/project-overview.md": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "d3c3cef21a356238fa2e8f05a2ebde2e52612c04",
  }),
  "docs/images/bodycast-body-map.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "53049e9ebe7a3c075bc1e7c81ba0e28847bfee2b",
  }),
  "docs/images/bodycast-dashboard.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "7aba3226b1ea631ce7d40492c9de972ec64dc15f",
  }),
  "docs/images/bodycast-diagnostics.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "1f6d931f67c5d4974eb1f55b1960ced06ac8cf3e",
  }),
  "docs/images/bodycast-forecast.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "4a07a50641beee0ed2613c373e11fd7a56284a5d",
  }),
  "docs/images/bodycast-history.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "7fac361843fbf336c132edefc6d0960a486c0fd8",
  }),
  "docs/images/bodycast-stepper-diagnostic.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "2397053778ef7c248cc95ba2c1dcae5eac69192a",
  }),
  "docs/images/bodycast-strength-session.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "cde65aa1432bd185e4b2ecc190e7bccf2c3ab742",
  }),
  "docs/images/bodycast-training.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "8bcb99f01f8d4c7808477621c59ff90fec36c20e",
  }),
  "docs/qa/fullsite-preview.md": Object.freeze({
    migrationOriginBlob: "9574934e4f461d575a7e1d37c7ee943b96a0cbeb",
    deployBlob: "85cf987064bc9c0490f8aeb0ff0adec5b77ac096",
  }),
  "scripts/qa/fullsite-preview-seed.ts": Object.freeze({
    migrationOriginBlob: "b24b4cff0bf5dc896fe16caa20796281374c1a37",
    deployBlob: "ff200aa8bf58f9ea970b71699c0e853642a9d3bb",
  }),
  "src/model/personalization-calibration.ts": Object.freeze({
    migrationOriginBlob: "c643b2ec22540249882a2887f4936f8297de6d77",
    deployBlob: "0110919368243a924f7d51a2a15b4d1679ccdfbe",
  }),
  "src/model/physiology-v7/daily-runtime-v7.ts": Object.freeze({
    migrationOriginBlob: "0dfd1eadd5b80195e3bcd37b7abff13412126d5c",
    deployBlob: Object.freeze([
      "44b16cc169a18860bf1f169b7a5da78e996d038b",
      "1fd0c72549ec127c4c9676bb9410d3fdc056e225",
    ]),
  }),
  "src/model/weight-observation-filter.ts": Object.freeze({
    migrationOriginBlob: "bc0c0951cff1f52a073f01c9ec8ea0238772ee6b",
    deployBlob: "d9820a4387dacd1dd3d517b6a1365ac0a87a343f",
  }),
  "src/modules/model-episodes/physiology-v7-persistence.ts": Object.freeze({
    migrationOriginBlob: "5550ee06c6de2d62865f558a6efa3cf266d05be6",
    deployBlob: "3cb74e37de5c27055e3197f089e34df44841c4df",
  }),
  "src/modules/model-episodes/physiology-v7-runtime.repository.ts": Object.freeze({
    migrationOriginBlob: "2a1330cc97a212cdef130829b1050a4081b87954",
    deployBlob: Object.freeze([
      "03fb4ef0c390edf070b7b27b26f569cc0508e2f4",
      "70b84e088d250335cab440d3364ab4dca6acbc94",
    ]),
  }),
  "src/modules/model-episodes/physiology-v7-runtime.service.ts": Object.freeze({
    migrationOriginBlob: "a6a7944132917abd62f812722726f022bce5ead0",
    deployBlob: "93a1bb44605ebf781511d4c82dabe6dff1129e87",
  }),
  "src/modules/model-episodes/physiology-v7-runtime.contract.ts": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "3d7edcaa57ee5eeffb7c92972a5bf5a778a338d5",
  }),
  ".github/workflows/production-full-history-recalculate.yml": Object.freeze({
    migrationOriginBlob: "4853dd4994278c6d7bfaa067fd3577b354c4c6dc",
    deployBlob: "f307319a0016e422156a2db4caebdd614c167d5d",
  }),
  "scripts/deploy.sh": Object.freeze({
    migrationOriginBlob: "557dafb14f1b68e3cd0d904a8668a1f1073bd025",
    deployBlob: Object.freeze([
      "019604bb624322d2099b8f05c8f9d63f218cf256",
      "d61f76029dd457bae62ccdeec25b212c0094c9f6",
      "9ffffae4430876b2e06ae590fa0c6e58490b20e8",
      "b9ac4565b6a352d52fae63d66495ca364e795281",
      "f8f1260935d060bac853ebf9678e2c86e5876195",
      "1ddf90306cfae3823195c9e17cd50453e3158adb",
      "b8806a7319f5f9d9308edf9f0079f1db967048b4",
      "9154d32837e29499c481532e5745e0619e5958fb",
    ]),
  }),
  "scripts/production-db-target.sh": Object.freeze({
    migrationOriginBlob: "6ee2fb323364c065c0723a42861c6bdc0a120a70",
    deployBlob: Object.freeze([
      "6ee2fb323364c065c0723a42861c6bdc0a120a70",
      "c3a7a37cf46c2653b05906515c5f3785be768a46",
    ]),
  }),
  "scripts/production-traffic-cutover.sh": Object.freeze({
    migrationOriginBlob: "3fd321d857e2aa024e4875a2689a588dc07078ee",
    deployBlob: Object.freeze([
      "3fd321d857e2aa024e4875a2689a588dc07078ee",
      "4b7ed6e33ad583bc058b6a17bdd95a1269ae3f5c",
      "046a694a3044d9e51273bb16a0ba3848c1ac3a8b",
      "fc59d0aac9e166291135e920aa5979064e296eac",
      "e84ce0ab584052bbeadee2a5a08f93d524d7ee23",
      "2e86ab1f4d9cd25db2b6e96f326151f9b7a25ae9",
      "5ce1ee1318989351c6685cb5500ad33b961c9978",
      "b0f26cf89fc8c843b497d2f9440afb733cd55be0",
      "d600fd3de2c9f025774e1c950baac2e2c4e92667",
      "e412b404f3e8d70b9c005572cdbb18e39d2c68bb",
      "623359e02225bb7ab2372463144c0552d0f4feed",
      "31631c8dce4ef102f7e7a60e147f5abd71f4b4ff",
    ]),
  }),
  "scripts/production-route-primitives.sh": Object.freeze({
    migrationOriginBlob: "5c9c2fa46e69fe9ed54b254d66cac67152de5961",
    deployBlob: "d9ef6b3bb01d1d36288a62873fba685846029ddd",
  }),
  "scripts/production-release-marker.sh": Object.freeze({
    migrationOriginBlob: "3aea7779d5a3b5e8438367be7e372a224672fb8d",
    deployBlob: "c2d45ada47d6c63eaa744a365bce8200d23e61e2",
  }),
  "src/app/training/exercise-info.ts": Object.freeze({
    migrationOriginBlob: "0f310bb071b918a2cb95bfe2d8e75033bf14811f",
    deployBlob: Object.freeze(["e155126c355c79e404e56d756b73821b057a7a12", "efffbd8bd49f1a7e45468f752f24e3aab4abf587"]),
  }),
  "src/app/training/session-accounting-panel.tsx": Object.freeze({
    migrationOriginBlob: "3d60397e44947547d5b1dfdf9f89a338c79f3954",
    deployBlob: "0bd81716820d49d260edea7d656699199b5e31cb",
  }),
  "src/app/training/sessions/[id]/session-client.tsx": Object.freeze({
    migrationOriginBlob: "d085fb60abcd1911efa49ee2061429a553992b8b",
    deployBlob: Object.freeze([
      "9c89a3751af7fa51b7f921b8ba1970e21496ea7e",
      "a57eb6d4b9fa963f2176bc81411776235b96ac11",
      "879ac3ce55658e1d2dee845cada46045c2b147e0",
      "e5dc70985bddeced732844b7d15b7eab363a6219",
    ]),
  }),
  "src/app/training/sessions/[id]/edit/session-edit-client.tsx": Object.freeze({
    migrationOriginBlob: "c338a7d9f38be5d296c94916283807c91f708160",
    deployBlob: "075310f73317c0160b51e36c9955cb5667384e82",
  }),
  "src/app/training/exercise-load-config-editor.tsx": Object.freeze({
    migrationOriginBlob: "ce7fff772c06e03c2cd9f5e4facb84abc7c5d72c",
    deployBlob: Object.freeze(["5f766256a43903d60d2be10a542e60ff1d8278dd", "6a0378c72c90652f1e715aa7d8d5bf9ebeaaa666"]),
  }),
  "src/app/training/training-labels.ts": Object.freeze({
    migrationOriginBlob: "503587495e9dd9ed428715668cf34978c0faa94f",
    deployBlob: "164138be83b309a09722bed8774696f7187f5795",
  }),
  "src/modules/training/canonical-exercise-identity.ts": Object.freeze({
    migrationOriginBlob: "22d496aaa71a85a52517a94da249e5df6008588e",
    deployBlob: Object.freeze(["378cd9d6cf0f5b0d46c901454a25712c620d342d", "44b2f7fb215500a26004ceed76a98e9107e33863"]),
  }),
  "src/modules/training/external-load-accounting.ts": Object.freeze({
    migrationOriginBlob: "5e379d1fb29b0acccea763858c718eb6f7bf1378",
    deployBlob: Object.freeze(["0cc1694d4e5ad27eddbe2e492d28ed8e637c1437", "a835068c69a3e5e8d0079291223c540122fe0596"]),
  }),
  "src/modules/training/load-accounting-v1.ts": Object.freeze({
    migrationOriginBlob: "dc1f97440c0334666275c5df2398479f52c397a9",
    deployBlob: Object.freeze(["d747be980284e44bf10d099edd823ff8da5ab54c", "b047dca0e371c52579ced39c9fafe5aa38015251"]),
  }),
  "src/modules/training/training.constants.ts": Object.freeze({
    migrationOriginBlob: "e21d9fdd64700f4b6ee8f84c22a457fc08972c4d",
    deployBlob: Object.freeze(["583449d202bbc3703787bc02c84937b9e1592768", "8ba5447f447e2ec2f5140591b6a9eda52da2a096"]),
  }),
  "src/modules/training/training.repository.ts": Object.freeze({
    migrationOriginBlob: "302a8a821f5983bcb289b40462032541932645c6",
    deployBlob: "f87c9896e702b9ad825b053e8a31de4a5ba4bf10",
  }),
  "public/training/exercises/barbell-hip-thrust.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "090fb793ae0d301df4bf57f925d5e77e40329af3",
  }),
  "public/training/exercises/cable-glute-kickback.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "a670976b2160010363b53d6caf9923001000314b",
  }),
  "public/training/exercises/cable-hip-abduction.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "c544e4b37f12c4a8da935912693de4407c3773c8",
  }),
  "public/training/exercises/cable-hip-adduction.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "609364fba69d7b7f8742609d7d83a09732026110",
  }),
  "public/training/exercises/cable-leg-curl.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "aa34afaefc6dda49d20d154cdc7062631c6d3683",
  }),
  "public/training/exercises/front-foot-elevated-split-squat.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "efb1b41194235954a88e438b0698848923f23457",
  }),
  "public/training/exercises/romanian-deadlift.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "7d7af7a722f7f4e771f198a2c8a18d4f108926bc",
  }),
  "public/training/exercises/seated-calf-raise.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "dd0cd0fd93014dccdec417c02d738b210f569b74",
  }),
  "public/training/exercises/single-leg-standing-calf-raise.png": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "5fa5165b31acbdbd5b4e19707960ddabd33813b3",
  }),
  "public/training/categories/abs.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "f6f7d5f8d833217588f118ff8fdb2f4bdc188352" }),
  "public/training/categories/arms.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "939b80dede7d931dd05b2f355f0722ddde437421" }),
  "public/training/categories/back.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "578fffef79610075e16cfbedffbcf4d37ff9215b" }),
  "public/training/categories/chest.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "3228d57bc9ed396b9311f5e2d9b24b88ed4bd933" }),
  "public/training/categories/glutes.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "f83fb4d259b2583b9cee036518012e5ebb249333" }),
  "public/training/categories/legs.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "9568ab2e2f4c28947fe171f96eb71d1ad25d5a40" }),
  "public/training/categories/shoulders.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "bc1a79352026dc216ee9257750cf1f14568e0e29" }),
  "public/training/exercises/barbell-upright-row.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "36b3c854f50b2c60538c3f07f25f4158050a8d96" }),
  "public/training/exercises/dumbbell-front-raise-alternating.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "285292eacc105968180d5a4237ca923ab91c18fa" }),
  "public/training/exercises/dumbbell-front-raise-bilateral.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "40aa61f886474732a507f76d62ad6fa9ab0014e1" }),
  "public/training/exercises/dumbbell-hammer-curl-alternating.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "a656985bd62e11703849c2e117f89d411b337cfa" }),
  "public/training/exercises/dumbbell-hammer-curl-bilateral.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "8e54e2b9719b76cd345d76c9b2d7bfb829952a22" }),
  "public/training/exercises/dumbbell-lateral-raise-bilateral.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "4d879679a62f5a039195f82eacc798930aff620d" }),
  "public/training/exercises/dumbbell-supinated-curl-alternating.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "2a9ee93651a624be1ac26e5099fa5f4c35e2aefc" }),
  "public/training/exercises/dumbbell-supinated-curl-bilateral.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "f67c78a52416a6b2b06186f2d30d66f96aa67d5d" }),
  "public/training/exercises/flat-dumbbell-bench-press.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "2daa81174947963899676548928446a11c7dce8d" }),
  "public/training/exercises/incline-push-up-bench.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "f03d0bca64e1c20bbafa1e7f77a3de0233622d50" }),
  "public/training/exercises/knee-push-up-bench.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "e363d32f81fe306281a70f8088061cf507a9af44" }),
  "public/training/exercises/knee-push-up-floor.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "3eeae07d846719eade20235b234584fd9594579f" }),
  "public/training/exercises/lying-ez-bar-triceps-extension-flat.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "e2892df970635eb57552be4a29b99da87fe422ea" }),
  "public/training/exercises/lying-ez-bar-triceps-extension-incline-30.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "c10ba1a1e9fba7938c8cc05b0561f65c64ee626d" }),
  "public/training/exercises/lying-single-arm-dumbbell-triceps-extension-flat.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "2498f3df5e2b599d3a816241fbee74d886ba55db" }),
  "public/training/exercises/lying-two-hand-dumbbell-triceps-extension-flat.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "47d532f0dbd6d9a17766ec50e590de44f3ac6a63" }),
  "public/training/exercises/one-arm-dumbbell-row-bench-supported.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "496db28c40643e5f5d5cbcfbaf1f480abc490d48" }),
  "public/training/exercises/overhead-ez-bar-triceps-extension-seated-30.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "e37e2d62d15e4b555d58a23026861db2eafce334" }),
  "public/training/exercises/overhead-ez-bar-triceps-extension-seated-90.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "0fbd8270e1d9640a0c769f86775ad8c421236597" }),
  "public/training/exercises/overhead-single-arm-dumbbell-triceps-extension-incline-30.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "4412b48cf995b1246c926bebe167f061d5f7f637" }),
  "public/training/exercises/overhead-single-arm-dumbbell-triceps-extension-seated-90.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "ff1f15cafebc77221a701deba68fb08b7155c07b" }),
  "public/training/exercises/overhead-two-hand-dumbbell-triceps-extension-incline-30.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "9ec0d4743691dde59602d584734d2c35d21a2c7b" }),
  "public/training/exercises/overhead-two-hand-dumbbell-triceps-extension-seated-90.webp": Object.freeze({ migrationOriginBlob: null, deployBlob: "e8dbaecabfd66de316092442fcafc128bf729500" }),
  "src/app/training/exercise-picker-catalog.ts": Object.freeze({ migrationOriginBlob: null, deployBlob: "20e29fbc9cef04e4d3abdca11c2bfe74708d9bc2" }),
  "src/app/training/exercise-picker.module.css": Object.freeze({ migrationOriginBlob: null, deployBlob: "3c9952ca294eeb95514fdf5129d432d9e5791b59" }),
  "src/app/training/exercise-picker.tsx": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: Object.freeze([
      "68d66903d3d227c16b5c404e1a5f2d24c75768ed",
      "d435ffc688aca08ccc2a56679fd64c215b5029d8",
    ]),
  }),
  "src/app/training/program-editor.tsx": Object.freeze({
    migrationOriginBlob: "fb7ba4532f32a7ac9448f42e56f5daaecdc1a5e3",
    deployBlob: Object.freeze([
      "4d49188decb73f4a8da2bbd8931c8663367e0d83",
      "096cc54187d9aac29d8aba244b54d3f6dc9816f0",
    ]),
  }),
  "src/app/training/training.module.css": Object.freeze({
    migrationOriginBlob: "583c713bc4aa9c16f1e3434b45808d9b9b98f7b4",
    deployBlob: Object.freeze([
      "07fd3e4ea3ffd6890dbdc26ca1830a71ef3f9251",
      "61e6130ee24437f8ef4318a0433d3a302e7b4704",
    ]),
  }),
  "src/app/training/exercise-picker-url-state.ts": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "955becda2e6010e563fdae6f92d7535896ab289a",
  }),
  "src/proxy.ts": Object.freeze({ migrationOriginBlob: "b010c51862a6a68c8ccc892d4a6a3be5049b35d8", deployBlob: "a0a4745a63f9318b569d050aca5cc529dee03648" }),
});
const ADVANCEABLE_V3_STATES = new Set(["schema-applied", "app-ready"]);
const DYNAMIC_WORKOUT_CRITICAL_TREES = Object.freeze([...CRITICAL_TREES, "src/modules/training", ".github/workflows"]);
const DYNAMIC_WORKOUT_CRITICAL_FILES = Object.freeze([
  ...CRITICAL_FILES,
  "scripts/deploy.sh",
  "scripts/production-release-marker.sh",
  "scripts/production-release-marker.mjs",
  "scripts/production-migration-manifests.mjs",
  "scripts/production-app-capabilities.mjs",
  "scripts/production-app-capabilities.json",
]);
const TRAINING_MUTATION_LEDGER_CRITICAL_TREES = Object.freeze(["prisma", "src", ".github/workflows"]);
const TRAINING_MUTATION_LEDGER_CRITICAL_FILES = Object.freeze([
  "docker-compose.prod.yml",
  "package.json",
  "package-lock.json",
  "scripts/deploy.sh",
  "scripts/production-release-marker.mjs",
  "scripts/production-release-marker.sh",
  "scripts/production-migration-manifests.mjs",
  "scripts/production-schema-deploy-handoff.mjs",
]);

function reject(message) {
  throw new Error(`Schema deploy handoff blocked: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function field(line, key) {
  const prefix = `${key}=`;
  if (!line.startsWith(prefix)) reject(`marker field ${key} is not canonical`);
  return line.slice(prefix.length);
}

export function parseSchemaDeployMarker(text) {
  const bytes = Buffer.from(String(text ?? ""), "utf8");
  if (bytes.length === 0 || bytes.length > 4096) reject("marker is missing or oversized");
  const lines = bytes.toString("utf8").replace(/\n$/, "").split("\n");
  if (lines.length === 9 && lines[0] === "schemaVersion=2") {
    const marker = {
      schemaVersion: 2,
      manifestId: field(lines[1], "manifestId"),
      releaseSha: field(lines[2], "releaseSha"),
      state: field(lines[3], "state"),
      workflowRunId: field(lines[4], "workflowRunId"),
      workflowRunAttempt: Number(field(lines[5], "workflowRunAttempt")),
      authorizationId: field(lines[6], "authorizationId"),
      lineageDigest: field(lines[7], "lineageDigest"),
      spawnState: field(lines[8], "spawnState"),
    };
    return { marker, digest: sha256(bytes), bytes };
  }
  if (lines.length === 12 && lines[0] === "schemaVersion=3") {
    const marker = {
      schemaVersion: 3,
      manifestId: field(lines[1], "manifestId"),
      migrationOriginSha: field(lines[2], "migrationOriginSha"),
      deploySha: field(lines[3], "deploySha"),
      state: field(lines[4], "state"),
      workflowRunId: field(lines[5], "workflowRunId"),
      workflowRunAttempt: Number(field(lines[6], "workflowRunAttempt")),
      authorizationId: field(lines[7], "authorizationId"),
      lineageDigest: field(lines[8], "lineageDigest"),
      spawnState: field(lines[9], "spawnState"),
      sourceMarkerDigest: field(lines[10], "sourceMarkerDigest"),
      compatibilityDigest: field(lines[11], "compatibilityDigest"),
    };
    return { marker, digest: sha256(bytes), bytes };
  }
  reject("marker schema is not an admitted migration or deploy handoff");
}

function provenanceMatches(marker, pinned) {
  return marker.manifestId === pinned.manifestId
    && marker.workflowRunId === pinned.workflowRunId
    && marker.workflowRunAttempt === pinned.workflowRunAttempt
    && marker.authorizationId === pinned.authorizationId
    && marker.lineageDigest === pinned.lineageDigest
    && marker.spawnState === pinned.spawnState;
}

function v4SourceMarkerMatches(marker) {
  return marker.schemaVersion === 2
    && marker.releaseSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
    && marker.state === "app-ready"
    && provenanceMatches(marker, V4_REPUBLICATION_HANDOFF_PROVENANCE);
}

function dynamicWorkoutSourceMarkerMatches(marker) {
  return marker.schemaVersion === 2
    && marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID
    && SHA.test(String(marker.releaseSha ?? ""))
    && marker.state === "app-ready"
    && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
    && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
    && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
    && DIGEST.test(String(marker.lineageDigest ?? ""))
    && marker.spawnState === "started";
}

function authMultiuserSourceMarkerMatches(marker) {
  return marker.schemaVersion === 2
    && marker.manifestId === AUTH_MULTIUSER_MANIFEST_ID
    && SHA.test(String(marker.releaseSha ?? ""))
    && marker.state === "app-ready"
    && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
    && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
    && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
    && DIGEST.test(String(marker.lineageDigest ?? ""))
    && marker.spawnState === "started";
}

function trainingMutationSourceMarkerMatches(marker) {
  return marker.schemaVersion === 2
    && marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID
    && SHA.test(String(marker.releaseSha ?? ""))
    && marker.state === "schema-applied"
    && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
    && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
    && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
    && DIGEST.test(String(marker.lineageDigest ?? ""))
    && marker.spawnState === "started";
}

function trainingSessionContextSourceMarkerMatches(marker) {
  return marker.schemaVersion === 2
    && marker.manifestId === TRAINING_SESSION_CONTEXT_MANIFEST_ID
    && SHA.test(String(marker.releaseSha ?? ""))
    && marker.state === "schema-applied"
    && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
    && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
    && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
    && DIGEST.test(String(marker.lineageDigest ?? ""))
    && marker.spawnState === "started";
}

function trainingMutationSourceDigest(marker) {
  const sourceText = [
    "schemaVersion=2",
    `manifestId=${TRAINING_MUTATION_LEDGER_MANIFEST_ID}`,
    `releaseSha=${marker.migrationOriginSha}`,
    "state=schema-applied",
    `workflowRunId=${marker.workflowRunId}`,
    `workflowRunAttempt=${marker.workflowRunAttempt}`,
    `authorizationId=${marker.authorizationId}`,
    `lineageDigest=${marker.lineageDigest}`,
    "spawnState=started",
    "",
  ].join("\n");
  return sha256(Buffer.from(sourceText, "utf8"));
}

function admittedV3Marker(marker) {
  if (marker.manifestId === AUTH_MULTIUSER_MANIFEST_ID) {
    return SHA.test(String(marker.migrationOriginSha ?? ""))
      && SHA.test(String(marker.deploySha ?? ""))
      && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
      && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
      && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
      && DIGEST.test(String(marker.lineageDigest ?? ""))
      && marker.spawnState === "started"
      && DIGEST.test(String(marker.sourceMarkerDigest ?? ""))
      && DIGEST.test(String(marker.compatibilityDigest ?? ""));
  }
  if (marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID) {
    return SHA.test(String(marker.migrationOriginSha ?? ""))
      && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
      && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
      && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
      && DIGEST.test(String(marker.lineageDigest ?? ""));
  }
  if (marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID) {
    return SHA.test(String(marker.migrationOriginSha ?? ""))
      && marker.deploySha === marker.migrationOriginSha
      && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
      && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
      && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
      && DIGEST.test(String(marker.lineageDigest ?? ""))
      && DIGEST.test(String(marker.sourceMarkerDigest ?? ""))
      && trainingMutationSourceDigest(marker) === marker.sourceMarkerDigest;
  }
  if (marker.migrationOriginSha === SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA) {
    return marker.manifestId === SCHEMA_DEPLOY_HANDOFF_PROVENANCE.manifestId
      && provenanceMatches(marker, SCHEMA_DEPLOY_HANDOFF_PROVENANCE);
  }
  return marker.migrationOriginSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
    && provenanceMatches(marker, V4_REPUBLICATION_HANDOFF_PROVENANCE);
}

export function compatibilityDigest(input) {
  const evidence = {
    migrationOriginSha: input.migrationOriginSha,
    deploySha: input.deploySha,
    changedPaths: [...input.changedPaths].sort(),
    criticalObjects: input.criticalObjects,
  };
  const contentBoundPaths = input.changedPathObjects ?? {};
  if (Object.keys(contentBoundPaths).length > 0) {
    evidence.changedPathObjects = Object.fromEntries(Object.keys(contentBoundPaths).sort().map((objectPath) => [
      objectPath,
      {
        migrationOriginBlob: contentBoundPaths[objectPath].migrationOriginBlob,
        deployBlob: contentBoundPaths[objectPath].deployBlob,
      },
    ]));
  }
  return sha256(Buffer.from(JSON.stringify(evidence), "utf8"));
}

export function serializeSchemaDeployHandoff(marker) {
  const text = [
    "schemaVersion=3",
    `manifestId=${marker.manifestId}`,
    `migrationOriginSha=${marker.migrationOriginSha}`,
    `deploySha=${marker.deploySha}`,
    `state=${marker.state}`,
    `workflowRunId=${marker.workflowRunId}`,
    `workflowRunAttempt=${marker.workflowRunAttempt}`,
    `authorizationId=${marker.authorizationId}`,
    `lineageDigest=${marker.lineageDigest}`,
    `spawnState=${marker.spawnState}`,
    `sourceMarkerDigest=${marker.sourceMarkerDigest}`,
    `compatibilityDigest=${marker.compatibilityDigest}`,
  ].join("\n") + "\n";
  const parsed = parseSchemaDeployMarker(text);
  if (parsed.marker.schemaVersion !== 3 || parsed.marker.migrationOriginSha !== marker.migrationOriginSha
    || parsed.marker.deploySha !== marker.deploySha || parsed.marker.state !== marker.state) {
    reject("serialized handoff did not round-trip");
  }
  return Buffer.from(text, "utf8");
}

export function validateHistoricalAuthMigrationRuns(migrationRun, ciRun) {
  const runIsExact = migrationRun?.id === Number(AUTH_MULTIUSER_MIGRATION_WORKFLOW_RUN_ID)
    && migrationRun.path === ".github/workflows/production-migrate.yml"
    && migrationRun.event === "workflow_dispatch"
    && migrationRun.status === "completed" && migrationRun.conclusion === "success"
    && migrationRun.head_sha === AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA
    && migrationRun.head_branch === "main" && migrationRun.run_attempt === 1
    && String(migrationRun.actor?.id ?? "") === AUTH_MULTIUSER_MIGRATION_ACTOR_ID
    && migrationRun.repository?.full_name === "krustallik/body-model";
  const ciIsExact = ciRun?.id === Number(AUTH_MULTIUSER_MIGRATION_CI_RUN_ID)
    && ciRun.path === ".github/workflows/ci.yml"
    && ciRun.event === "push"
    && ciRun.status === "completed" && ciRun.conclusion === "success"
    && ciRun.head_sha === AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA
    && ciRun.head_branch === "main" && ciRun.run_attempt === 1
    && String(ciRun.actor?.id ?? "") === AUTH_MULTIUSER_MIGRATION_ACTOR_ID
    && ciRun.repository?.full_name === "krustallik/body-model";
  if (!runIsExact || !ciIsExact) reject("the historical owner-authorized Auth migration and its exact-SHA CI evidence do not match the pinned release lineage");
  return true;
}

export function buildAuthSchemaReattestation({ report, deploySha, repo, workflowRunId, workflowRunAttempt, authorizationId }) {
  if (!SHA.test(String(deploySha ?? "")) || !/^[1-9][0-9]{0,19}$/.test(String(workflowRunId ?? ""))
    || !Number.isSafeInteger(workflowRunAttempt) || workflowRunAttempt < 1
    || !/^[a-f0-9]{64}$/.test(String(authorizationId ?? ""))) {
    reject("Auth schema re-attestation is not bound to an exact deploy SHA and one-use owner OIDC receipt");
  }
  let compatibility;
  try {
    compatibility = readGitCompatibility(repo, deploySha, AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA, AUTH_MULTIUSER_MANIFEST_ID);
  } catch (error) {
    reject(`the exact candidate is not compatible with the verified Auth schema origin: ${String(error?.message ?? error)}`);
  }
  assertCompatibleChangedPaths(compatibility.changedPaths, compatibility.changedPathObjects,
    AUTH_MULTIUSER_CONTENT_BOUND_PATHS, AUTH_MULTIUSER_NON_RUNTIME_PATH);
  assertCriticalObjects(compatibility.criticalObjects, AUTH_MULTIUSER_CRITICAL_TREES, AUTH_MULTIUSER_CRITICAL_FILES);
  if (compatibility.isAncestor !== true) reject("the candidate is not a descendant of the verified Auth migration origin");

  let migrationDirectories;
  try {
    migrationDirectories = git(repo, ["ls-tree", "-d", "--name-only", `${deploySha}:prisma/migrations`]).split("\n").filter(Boolean);
  } catch { reject("the exact candidate migration tree could not be read"); }
  const schema = evaluateProductionPostflight(report, migrationDirectories, AUTH_MULTIUSER_MANIFEST_ID);
  if (schema.ready !== true) reject(`the read-only production schema report failed the Auth postflight contract (${schema.blockers.length} blocker(s))`);
  if (!/^[a-f0-9]{64}$/.test(String(report.logicalDataFingerprint ?? ""))) reject("the read-only production report is missing its logical-data fingerprint");

  const migrationRows = [...report.migrations].map((row) => ({
    name: row.name, checksum: row.checksum, startedAt: row.startedAt, finishedAt: row.finishedAt,
    rolledBackAt: row.rolledBackAt, hasLogs: row.hasLogs, logsFingerprint: row.logsFingerprint,
  })).sort((left, right) => left.name.localeCompare(right.name));
  const evidence = {
    contract: "bodycast-auth-schema-reattest-v1",
    migration: {
      workflowRunId: AUTH_MULTIUSER_MIGRATION_WORKFLOW_RUN_ID,
      workflowPath: ".github/workflows/production-migrate.yml",
      sha: AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA,
      ciRunId: AUTH_MULTIUSER_MIGRATION_CI_RUN_ID,
      actorId: AUTH_MULTIUSER_MIGRATION_ACTOR_ID,
    },
    candidate: { sha: deploySha, workflowRunId: String(workflowRunId), workflowRunAttempt },
    databaseIdentityDigest: sha256(Buffer.from(JSON.stringify(report.identity), "utf8")),
    migrationHistoryDigest: sha256(Buffer.from(JSON.stringify(migrationRows), "utf8")),
    schemaInventoryDigest: schemaInventoryDigest(report.objects),
    logicalDataFingerprint: report.logicalDataFingerprint,
  };
  const sourceMarkerDigest = sha256(Buffer.from(JSON.stringify(evidence), "utf8"));
  const lineageDigest = sha256(Buffer.from(`bodycast-auth-schema-reattest-lineage-v1\n${sourceMarkerDigest}\n${authorizationId}\n`, "utf8"));
  const compatibilityHash = compatibilityDigest({
    migrationOriginSha: AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA,
    deploySha,
    changedPaths: compatibility.changedPaths,
    changedPathObjects: compatibility.changedPathObjects,
    criticalObjects: compatibility.criticalObjects,
  });
  const marker = {
    manifestId: AUTH_MULTIUSER_MANIFEST_ID,
    migrationOriginSha: AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA,
    deploySha,
    state: "schema-applied",
    workflowRunId: String(workflowRunId),
    workflowRunAttempt,
    authorizationId,
    lineageDigest,
    spawnState: "started",
    sourceMarkerDigest,
    compatibilityDigest: compatibilityHash,
  };
  return { marker, bytes: serializeSchemaDeployHandoff(marker), schemaInventoryDigest: evidence.schemaInventoryDigest };
}

export async function applyAuthSchemaReattestation({ markerPath, legacyMarkerPath, reportPath, deploySha, repo, workflowRunId, workflowRunAttempt, authorizationId }) {
  const markerDirectory = path.dirname(markerPath);
  const directoryInfo = await lstat(markerDirectory).catch(() => null);
  if (!directoryInfo?.isDirectory() || directoryInfo.isSymbolicLink()) reject("the production release marker directory is missing or unsafe");
  for (const candidate of [markerPath, legacyMarkerPath]) {
    if (!candidate) continue;
    const existing = await lstat(candidate).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (existing) reject("an existing release marker appeared; Auth schema re-attestation only starts from an absent marker");
  }
  const reportInfo = await lstat(reportPath).catch(() => null);
  if (!reportInfo?.isFile() || reportInfo.isSymbolicLink() || (reportInfo.mode & 0o077) !== 0) reject("the production schema report is missing, linked, or not private");
  const reportText = await readFile(reportPath, "utf8");
  if (Buffer.byteLength(reportText, "utf8") > 32 * 1024 * 1024) reject("the production schema report exceeds the bounded size");
  let report;
  try { report = JSON.parse(reportText); } catch { reject("the production schema report is malformed"); }
  const plan = buildAuthSchemaReattestation({ report, deploySha, repo, workflowRunId, workflowRunAttempt, authorizationId });
  const lockPath = `${markerPath}.lock`;
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error?.code === "EEXIST") reject("another schema deploy handoff is already active or interrupted");
    throw error;
  });
  const temporary = path.join(markerDirectory, `.auth-schema-reattest.${process.pid}.${Date.now()}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(plan.bytes); await handle.sync(); }
    finally { await handle.close(); }
    for (const candidate of [markerPath, legacyMarkerPath]) {
      if (!candidate) continue;
      const existing = await lstat(candidate).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
      if (existing) reject("a release marker appeared during Auth schema re-attestation");
    }
    await link(temporary, markerPath);
    await unlink(temporary);
    await fsyncDirectory(markerDirectory);
    return { action: "write", marker: plan.marker, schemaInventoryDigest: plan.schemaInventoryDigest };
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

function assertCompatibleChangedPaths(changedPaths, changedPathObjects, contentBoundPaths = CONTENT_BOUND_PATHS, unboundNonRuntimePath) {
  if (!Array.isArray(changedPaths) || !changedPaths.every((changed) => typeof changed === "string")) {
    reject("compatibility evidence is incomplete");
  }
  if (changedPathObjects !== undefined
    && (!changedPathObjects || typeof changedPathObjects !== "object" || Array.isArray(changedPathObjects))) {
    reject("content-bound path evidence is malformed");
  }
  if (new Set(changedPaths).size !== changedPaths.length) reject("compatibility path evidence is duplicated");
  const contentBoundChangedPaths = changedPaths.filter((changed) => Object.hasOwn(contentBoundPaths, changed)).sort();
  const suppliedContentBoundPaths = changedPathObjects && typeof changedPathObjects === "object" && !Array.isArray(changedPathObjects)
    ? Object.keys(changedPathObjects).sort()
    : [];
  if (contentBoundChangedPaths.length !== suppliedContentBoundPaths.length
    || contentBoundChangedPaths.some((objectPath, index) => objectPath !== suppliedContentBoundPaths[index])) {
    reject("content-bound path evidence is incomplete or unexpected");
  }
  for (const changed of changedPaths) {
    const reviewedBlobs = contentBoundPaths[changed];
    if (changed.length === 0 || (!reviewedBlobs && DENIED_PATH.test(changed))) {
      reject(`path ${changed} is outside the reviewed deploy compatibility allowlist`);
    }
    const proof = changedPathObjects?.[changed];
    if (reviewedBlobs) {
      const allowedDeployBlobs = Array.isArray(reviewedBlobs.deployBlob)
        ? reviewedBlobs.deployBlob
        : [reviewedBlobs.deployBlob];
      if (!proof || typeof proof !== "object" || Array.isArray(proof)
        || Object.keys(proof).sort().join(",") !== "deployBlob,migrationOriginBlob"
        || allowedDeployBlobs.length === 0
        || allowedDeployBlobs.some((blob) => typeof blob !== "string" || !/^[a-f0-9]{40}$/.test(blob))
        || (reviewedBlobs.migrationOriginBlob === null
          ? proof.migrationOriginBlob !== null
          : typeof proof.migrationOriginBlob !== "string" || !/^[a-f0-9]{40}$/.test(proof.migrationOriginBlob))
        || typeof proof.deployBlob !== "string" || !/^[a-f0-9]{40}$/.test(proof.deployBlob)
        || proof.migrationOriginBlob !== reviewedBlobs.migrationOriginBlob
        || !allowedDeployBlobs.includes(proof.deployBlob)) {
        reject(`path ${changed} does not match its exact reviewed content binding`);
      }
      continue;
    }
    if (unboundNonRuntimePath) {
      if (unboundNonRuntimePath.test(changed)) continue;
      reject(`path ${changed} is not allowlisted for this schema handoff`);
    }
    if (ALLOWED_PATH.test(changed)) continue;
    reject(`path ${changed} is outside the reviewed deploy compatibility allowlist`);
  }
}

function assertCriticalObjects(criticalObjects, trees = CRITICAL_TREES, files = CRITICAL_FILES) {
  if (!criticalObjects || typeof criticalObjects !== "object" || Array.isArray(criticalObjects)) {
    reject("compatibility evidence is incomplete");
  }
  for (const objectPath of [...trees, ...files]) {
    if (typeof criticalObjects[objectPath] !== "string" || !/^[a-f0-9]{40}$/.test(criticalObjects[objectPath])) {
      reject(`critical object proof for ${objectPath} is incomplete`);
    }
  }
}

function buildHandoffWrite({
  observed,
  migrationOriginSha,
  deploySha,
  state,
  changedPaths,
  changedPathObjects,
  criticalObjects,
  workflowRunId,
  workflowRunAttempt,
  authorizationId,
  lineageDigest,
  spawnState,
  provenance,
  contentBoundPaths,
  unboundNonRuntimePath,
}) {
  assertCompatibleChangedPaths(changedPaths, changedPathObjects, contentBoundPaths, unboundNonRuntimePath);
  assertCriticalObjects(criticalObjects);
  const digest = compatibilityDigest({
    migrationOriginSha,
    deploySha,
    changedPaths,
    changedPathObjects,
    criticalObjects,
  });
  const next = {
    manifestId: provenance.manifestId,
    migrationOriginSha,
    deploySha,
    state,
    workflowRunId,
    workflowRunAttempt,
    authorizationId,
    lineageDigest,
    spawnState,
    sourceMarkerDigest: observed.digest,
    compatibilityDigest: digest,
  };
  return {
    action: "write",
    marker: next,
    sourceDigest: observed.digest,
    compatibilityDigest: digest,
    bytes: serializeSchemaDeployHandoff(next),
  };
}

export function evaluateSchemaDeployHandoff({ markerText, deploySha, changedPaths, changedPathObjects, isAncestor, criticalObjects }) {
  if (!SHA.test(String(deploySha ?? ""))) reject("deploy candidate SHA is malformed");
  const observed = parseSchemaDeployMarker(markerText);
  const marker = observed.marker;
  if (marker.schemaVersion === 2 && marker.manifestId === TRAINING_SESSION_CONTEXT_MANIFEST_ID) {
    if (!trainingSessionContextSourceMarkerMatches(marker) || marker.releaseSha !== deploySha) {
      reject("training session-context migration requires its exact schema-applied release SHA and acknowledged lineage");
    }
    return { action: "not-needed", marker, sourceDigest: observed.digest };
  }
  if (marker.schemaVersion === 2 && marker.manifestId === AUTH_MULTIUSER_MANIFEST_ID) {
    if (!authMultiuserSourceMarkerMatches(marker)) {
      reject("Auth migration marker run, lineage, origin, or state is not admitted");
    }
    assertCompatibleChangedPaths(changedPaths, changedPathObjects, AUTH_MULTIUSER_CONTENT_BOUND_PATHS, AUTH_MULTIUSER_NON_RUNTIME_PATH);
    assertCriticalObjects(criticalObjects, AUTH_MULTIUSER_CRITICAL_TREES, AUTH_MULTIUSER_CRITICAL_FILES);
    if (isAncestor !== true) reject("deploy candidate is not a descendant of the Auth migration app-ready release");
    if (deploySha === marker.releaseSha) reject("an app-ready Auth marker cannot be reused as a schema-applied deploy marker");
    return buildHandoffWrite({
      observed,
      migrationOriginSha: marker.releaseSha,
      deploySha,
      state: "schema-applied",
      changedPaths,
      changedPathObjects,
      criticalObjects,
      workflowRunId: marker.workflowRunId,
      workflowRunAttempt: marker.workflowRunAttempt,
      authorizationId: marker.authorizationId,
      lineageDigest: marker.lineageDigest,
      spawnState: marker.spawnState,
      provenance: { manifestId: AUTH_MULTIUSER_MANIFEST_ID },
      contentBoundPaths: AUTH_MULTIUSER_CONTENT_BOUND_PATHS,
      unboundNonRuntimePath: AUTH_MULTIUSER_NON_RUNTIME_PATH,
    });
  }
  if (marker.schemaVersion === 2 && marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID) {
    if (marker.state === "schema-applied" && marker.releaseSha === deploySha
      && marker.spawnState === "started" && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
      && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
      && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
      && DIGEST.test(String(marker.lineageDigest ?? ""))) {
      return { action: "not-needed", marker, sourceDigest: observed.digest };
    }
    if (!dynamicWorkoutSourceMarkerMatches(marker)) {
      reject("programless-workout migration marker run, lineage, origin, or state is not admitted");
    }
    assertCompatibleChangedPaths(changedPaths, changedPathObjects, Object.freeze({}), DYNAMIC_WORKOUT_NON_RUNTIME_PATH);
    assertCriticalObjects(criticalObjects, DYNAMIC_WORKOUT_CRITICAL_TREES, DYNAMIC_WORKOUT_CRITICAL_FILES);
    if (isAncestor !== true) reject("deploy candidate is not a descendant of the programless-workout migration origin");
    if (deploySha === marker.releaseSha) reject("an app-ready migration marker cannot be reused as a schema-applied deploy marker");
    return buildHandoffWrite({
      observed,
      migrationOriginSha: marker.releaseSha,
      deploySha,
      state: "schema-applied",
      changedPaths,
      changedPathObjects,
      criticalObjects,
      workflowRunId: marker.workflowRunId,
      workflowRunAttempt: marker.workflowRunAttempt,
      authorizationId: marker.authorizationId,
      lineageDigest: marker.lineageDigest,
      spawnState: marker.spawnState,
      provenance: { manifestId: DYNAMIC_WORKOUT_MANIFEST_ID },
      contentBoundPaths: Object.freeze({}),
      unboundNonRuntimePath: DYNAMIC_WORKOUT_NON_RUNTIME_PATH,
    });
  }
  if (marker.schemaVersion === 2 && marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID) {
    if (!trainingMutationSourceMarkerMatches(marker)) {
      reject("Training migration marker run, attempt, authorization lineage, release SHA, or state is not admitted");
    }
    if (deploySha !== marker.releaseSha) {
      reject("Training schema handoff requires the app deploy SHA to equal the exact migration release SHA");
    }
    assertCompatibleChangedPaths(changedPaths, changedPathObjects, Object.freeze({}));
    assertCriticalObjects(criticalObjects, TRAINING_MUTATION_LEDGER_CRITICAL_TREES, TRAINING_MUTATION_LEDGER_CRITICAL_FILES);
    if (isAncestor !== true) reject("Training app deploy is not the exact migration release commit");
    return buildHandoffWrite({
      observed,
      migrationOriginSha: marker.releaseSha,
      deploySha,
      state: "schema-applied",
      changedPaths,
      changedPathObjects,
      criticalObjects,
      workflowRunId: marker.workflowRunId,
      workflowRunAttempt: marker.workflowRunAttempt,
      authorizationId: marker.authorizationId,
      lineageDigest: marker.lineageDigest,
      spawnState: marker.spawnState,
      provenance: { manifestId: TRAINING_MUTATION_LEDGER_MANIFEST_ID },
      contentBoundPaths: Object.freeze({}),
    });
  }
  if (marker.schemaVersion === 2 && marker.manifestId === V4_REPUBLICATION_MANIFEST_ID
    && marker.releaseSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
    && marker.releaseSha === deploySha && marker.state === "schema-applied"
    && provenanceMatches(marker, V4_REPUBLICATION_HANDOFF_PROVENANCE)) {
    return { action: "not-needed", marker, sourceDigest: observed.digest };
  }
  if (v4SourceMarkerMatches(marker)) {
    assertCompatibleChangedPaths(changedPaths, changedPathObjects, V4_CONTENT_BOUND_PATHS, V4_UNBOUND_NON_RUNTIME_PATH);
    assertCriticalObjects(criticalObjects);
    if (isAncestor !== true) reject("deploy candidate is not a descendant of the V4 migration origin");
    if (deploySha === marker.releaseSha) reject("an app-ready migration marker cannot be reused as a schema-applied deploy marker");
    return buildHandoffWrite({
      observed,
      migrationOriginSha: marker.releaseSha,
      deploySha,
      state: "schema-applied",
      changedPaths,
      changedPathObjects,
      criticalObjects,
      workflowRunId: marker.workflowRunId,
      workflowRunAttempt: marker.workflowRunAttempt,
      authorizationId: marker.authorizationId,
      lineageDigest: marker.lineageDigest,
      spawnState: marker.spawnState,
      provenance: V4_REPUBLICATION_HANDOFF_PROVENANCE,
      contentBoundPaths: V4_CONTENT_BOUND_PATHS,
      unboundNonRuntimePath: V4_UNBOUND_NON_RUNTIME_PATH,
    });
  }
  if (marker.schemaVersion === 2 && marker.manifestId === V4_REPUBLICATION_MANIFEST_ID) {
    reject("V4 migration marker run, lineage, origin, or state does not match the admitted DDL execution");
  }
  if (marker.schemaVersion === 3) {
    if (!admittedV3Marker(marker) || !V3_STATES.has(marker.state)
      || marker.spawnState !== "started" || !DIGEST.test(marker.sourceMarkerDigest) || !DIGEST.test(marker.compatibilityDigest)) {
      reject("existing handoff provenance is malformed");
    }
    const authMultiuserRelease = marker.manifestId === AUTH_MULTIUSER_MANIFEST_ID;
    const dynamicWorkoutRelease = marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID;
    const trainingRelease = marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID;
    const contentBoundPaths = authMultiuserRelease ? AUTH_MULTIUSER_CONTENT_BOUND_PATHS
      : dynamicWorkoutRelease || trainingRelease ? Object.freeze({})
      : marker.migrationOriginSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA ? V4_CONTENT_BOUND_PATHS : CONTENT_BOUND_PATHS;
    const unboundNonRuntimePath = authMultiuserRelease ? AUTH_MULTIUSER_NON_RUNTIME_PATH
      : dynamicWorkoutRelease ? DYNAMIC_WORKOUT_NON_RUNTIME_PATH
      : marker.migrationOriginSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA ? V4_UNBOUND_NON_RUNTIME_PATH : undefined;
    assertCompatibleChangedPaths(changedPaths, changedPathObjects, contentBoundPaths, unboundNonRuntimePath);
    assertCriticalObjects(criticalObjects,
      authMultiuserRelease ? AUTH_MULTIUSER_CRITICAL_TREES
        : dynamicWorkoutRelease ? DYNAMIC_WORKOUT_CRITICAL_TREES
        : trainingRelease ? TRAINING_MUTATION_LEDGER_CRITICAL_TREES : CRITICAL_TREES,
      authMultiuserRelease ? AUTH_MULTIUSER_CRITICAL_FILES
        : dynamicWorkoutRelease ? DYNAMIC_WORKOUT_CRITICAL_FILES
        : trainingRelease ? TRAINING_MUTATION_LEDGER_CRITICAL_FILES : CRITICAL_FILES);
    if (isAncestor !== true) reject("deploy candidate is not a descendant of the migration origin");
    if (trainingRelease && marker.migrationOriginSha !== deploySha) {
      reject("Training handoff replay requires the exact same migration and app deploy SHA");
    }
    if (marker.deploySha === deploySha) {
      const recomputed = compatibilityDigest({
        migrationOriginSha: marker.migrationOriginSha,
        deploySha: marker.deploySha,
        changedPaths,
        changedPathObjects,
        criticalObjects,
      });
      if (marker.compatibilityDigest !== recomputed) {
        reject("existing handoff does not match this deploy candidate");
      }
      return { action: "replay", marker, sourceDigest: observed.digest, compatibilityDigest: recomputed };
    }
    if (!ADVANCEABLE_V3_STATES.has(marker.state)) {
      reject("existing handoff state cannot advance to another deploy candidate");
    }
    return buildHandoffWrite({
      observed,
      migrationOriginSha: marker.migrationOriginSha,
      deploySha,
      state: "schema-applied",
      changedPaths,
      changedPathObjects,
      criticalObjects,
      provenance: marker,
      contentBoundPaths,
      unboundNonRuntimePath,
      workflowRunId: marker.workflowRunId,
      workflowRunAttempt: marker.workflowRunAttempt,
      authorizationId: marker.authorizationId,
      lineageDigest: marker.lineageDigest,
      spawnState: marker.spawnState,
    });
  }
  if (!provenanceMatches(marker, SCHEMA_DEPLOY_HANDOFF_PROVENANCE)) reject("marker authorization, lineage, or migration provenance does not match the admitted release");
  if (marker.schemaVersion !== 2 || marker.state !== "schema-applied" || marker.releaseSha !== SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA) {
    reject("only the admitted schema-applied migration origin can be handed off");
  }
  if (deploySha === marker.releaseSha) return { action: "not-needed", marker, sourceDigest: observed.digest };
  if (isAncestor !== true) reject("deploy candidate is not a descendant of the migration origin");
  return buildHandoffWrite({
    observed,
    migrationOriginSha: marker.releaseSha,
    deploySha,
    state: "schema-applied",
    changedPaths,
    changedPathObjects,
    criticalObjects,
    workflowRunId: marker.workflowRunId,
    workflowRunAttempt: marker.workflowRunAttempt,
    authorizationId: marker.authorizationId,
    lineageDigest: marker.lineageDigest,
    spawnState: marker.spawnState,
    provenance: SCHEMA_DEPLOY_HANDOFF_PROVENANCE,
  });
}

export function validateSchemaDeployHandoffMarker(markerText) {
  const marker = parseSchemaDeployMarker(markerText).marker;
  if (marker.schemaVersion !== 3 || !V3_STATES.has(marker.state) || marker.spawnState !== "started"
    || !DIGEST.test(marker.sourceMarkerDigest) || !DIGEST.test(marker.compatibilityDigest)
    || !admittedV3Marker(marker)) {
    reject("schema deploy handoff marker provenance is not admitted");
  }
  return marker;
}

export function validateAuthMarkerForTrainingMigrationHandoff(markerText, { liveAppSha, repositoryPath }) {
  const parsed = parseSchemaDeployMarker(markerText);
  const marker = parsed.marker;
  if (marker.schemaVersion !== 3 || marker.manifestId !== AUTH_MULTIUSER_MANIFEST_ID
    || marker.state !== "app-ready" || marker.deploySha !== liveAppSha
    || marker.migrationOriginSha !== AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA || !admittedV3Marker(marker)) {
    reject("Training migration predecessor is not the exact live Auth app-ready handoff");
  }
  const compatibility = readGitCompatibility(repositoryPath, marker.deploySha,
    marker.migrationOriginSha, AUTH_MULTIUSER_MANIFEST_ID);
  assertCompatibleChangedPaths(compatibility.changedPaths, compatibility.changedPathObjects,
    AUTH_MULTIUSER_CONTENT_BOUND_PATHS, AUTH_MULTIUSER_NON_RUNTIME_PATH);
  assertCriticalObjects(compatibility.criticalObjects, AUTH_MULTIUSER_CRITICAL_TREES, AUTH_MULTIUSER_CRITICAL_FILES);
  const expectedCompatibilityDigest = compatibilityDigest({
    migrationOriginSha: marker.migrationOriginSha,
    deploySha: marker.deploySha,
    changedPaths: compatibility.changedPaths,
    changedPathObjects: compatibility.changedPathObjects,
    criticalObjects: compatibility.criticalObjects,
  });
  if (marker.compatibilityDigest !== expectedCompatibilityDigest) {
    reject("Auth predecessor marker compatibility digest differs from its exact Git history");
  }
  return Object.freeze({
    ...marker,
    digest: parsed.digest,
  });
}

export function validateTrainingCaptureMarkerWitness({
  markerText, preflightResult, expectedReleaseSha, liveAppSha, repositoryPath,
}) {
  if (!preflightResult || typeof preflightResult !== "object" || Array.isArray(preflightResult)
    || preflightResult.manifestId !== TRAINING_SESSION_CONTEXT_MANIFEST_ID
    || preflightResult.preflightMode !== "pre-maintenance"
    || !SHA.test(String(expectedReleaseSha ?? "")) || preflightResult.releaseSha !== expectedReleaseSha
    || preflightResult.readyForOwnerAuthorization !== false
    || preflightResult.readyForPreMaintenance !== true
    || !Array.isArray(preflightResult.blockers) || preflightResult.blockers.length !== 0) {
    reject("Training capture requires successful exact-SHA Training pre-maintenance evidence");
  }
  const witness = preflightResult.sourceReleaseMarker;
  const fields = ["schemaVersion", "manifestId", "migrationOriginSha", "deploySha", "state", "workflowRunId",
    "workflowRunAttempt", "authorizationId", "lineageDigest", "spawnState", "sourceMarkerDigest",
    "compatibilityDigest", "digest", "liveAppSha"];
  if (!witness || typeof witness !== "object" || Array.isArray(witness)
    || JSON.stringify(Object.keys(witness).sort()) !== JSON.stringify([...fields].sort())) {
    reject("Training capture lacks the exact retained Auth marker witness");
  }
  const marker = validateAuthMarkerForTrainingMigrationHandoff(markerText, { liveAppSha, repositoryPath });
  const currentWitness = { ...marker, liveAppSha };
  if (JSON.stringify(Object.fromEntries(fields.map((field) => [field, currentWitness[field]])))
    !== JSON.stringify(Object.fromEntries(fields.map((field) => [field, witness[field]])))) {
    reject("The current Auth marker differs from successful Training pre-maintenance evidence");
  }
  return marker;
}

export function renderSchemaDeployTransition(markerText, state) {
  const marker = validateSchemaDeployHandoffMarker(markerText);
  if (!V3_STATES.has(state)) reject("transition is not a schema-deploy handoff state");
  return serializeSchemaDeployHandoff({ ...marker, state });
}

function git(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function objectId(repo, sha, objectPath) {
  try {
    return git(repo, ["rev-parse", `${sha}:${objectPath}`]);
  } catch {
    reject(`required object ${objectPath} is absent at ${sha}`);
  }
}

function regularFileBlobId(repo, sha, objectPath, optional = false) {
  let listing;
  try {
    listing = git(repo, ["ls-tree", "-z", sha, "--", objectPath]);
  } catch {
    reject(`Git tree lookup failed for ${objectPath}`);
  }
  if (!listing) {
    if (optional) return null;
    reject(`required file ${objectPath} is absent at ${sha}`);
  }
  const [entry, rawListedPath] = listing.split("\t");
  const listedPath = rawListedPath?.replace(/\0$/, "");
  const match = /^100644 blob ([a-f0-9]{40})$/.exec(entry ?? "");
  if (!match || listedPath !== objectPath) reject(`required file ${objectPath} is not a regular non-executable blob at ${sha}`);
  return match[1];
}

function assertDynamicWorkoutOriginContract(repo, originSha) {
  const manifest = DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST;
  const expectedDirectories = [...manifest.requiredAppliedMigrations, ...manifest.migrations].map(({ name }) => name).sort();
  let directories;
  try {
    directories = git(repo, ["ls-tree", "-d", "--name-only", `${originSha}:prisma/migrations`]).split("\n").filter(Boolean).sort();
  } catch {
    reject("programless-workout migration origin does not contain its reviewed Prisma migration tree");
  }
  if (JSON.stringify(directories) !== JSON.stringify(expectedDirectories)) {
    reject("programless-workout migration origin does not match the exact reviewed migration directory set");
  }
  for (const migration of [...manifest.requiredAppliedMigrations, ...manifest.migrations]) {
    let bytes;
    try { bytes = execFileSync("git", ["cat-file", "blob", `${originSha}:prisma/migrations/${migration.name}/migration.sql`], { cwd: repo }); }
    catch { reject(`programless-workout migration ${migration.name} is unavailable at the migration origin`); }
    if (sha256(bytes) !== migration.sha256) reject(`programless-workout migration ${migration.name} differs from its reviewed checksum`);
  }
  try {
    const contract = readProductionAppCapabilitiesAtSha({ repositoryPath: repo, releaseSha: originSha });
    if (!contract.capabilities.includes(PROGRAMLESS_STRENGTH_SESSIONS_CAPABILITY)) {
      reject("programless-workout migration origin app is not certified for nullable program relations");
    }
  } catch (error) {
    if (String(error?.message ?? "").startsWith("Schema deploy handoff blocked:")) throw error;
    reject("programless-workout migration origin app capability contract is absent or invalid");
  }
}

function assertAuthMultiuserOriginContract(repo, originSha) {
  const migrations = [...AUTH_MULTIUSER_MANIFEST.requiredAppliedMigrations, ...AUTH_MULTIUSER_MANIFEST.migrations];
  const expectedDirectories = migrations.map(({ name }) => name).sort();
  let directories;
  try {
    directories = git(repo, ["ls-tree", "-d", "--name-only", `${originSha}:prisma/migrations`]).split("\n").filter(Boolean).sort();
  } catch {
    reject("Auth migration origin does not contain its reviewed Prisma migration tree");
  }
  if (JSON.stringify(directories) !== JSON.stringify(expectedDirectories)) {
    reject("Auth migration origin does not match the exact reviewed migration directory set");
  }
  for (const migration of migrations) {
    let bytes;
    try { bytes = execFileSync("git", ["cat-file", "blob", `${originSha}:prisma/migrations/${migration.name}/migration.sql`], { cwd: repo }); }
    catch { reject(`Auth migration ${migration.name} is unavailable at the migration origin`); }
    if (sha256(bytes) !== migration.sha256) reject(`Auth migration ${migration.name} differs from its reviewed checksum`);
  }
}

function assertTrainingMutationOriginContract(repo, originSha) {
  const manifest = TRAINING_MUTATION_LEDGER_MANIFEST;
  const migrations = [...manifest.requiredAppliedMigrations, ...manifest.migrations];
  const expectedDirectories = migrations.map(({ name }) => name).sort();
  let directories;
  try {
    directories = git(repo, ["ls-tree", "-d", "--name-only", `${originSha}:prisma/migrations`]).split("\n").filter(Boolean).sort();
  } catch {
    reject("Training migration origin does not contain its reviewed Prisma migration tree");
  }
  if (JSON.stringify(directories) !== JSON.stringify(expectedDirectories)) {
    reject("Training migration origin does not match the exact 65-predecessor-plus-nine migration directory set");
  }
  for (const migration of migrations) {
    let bytes;
    try { bytes = execFileSync("git", ["cat-file", "blob", `${originSha}:prisma/migrations/${migration.name}/migration.sql`], { cwd: repo }); }
    catch { reject(`Training migration ${migration.name} is unavailable at the migration origin`); }
    if (sha256(bytes) !== migration.sha256) reject(`Training migration ${migration.name} differs from its reviewed checksum`);
  }
  for (const objectPath of [...TRAINING_MUTATION_LEDGER_CRITICAL_TREES, ...TRAINING_MUTATION_LEDGER_CRITICAL_FILES]) {
    objectId(repo, originSha, objectPath);
  }
}

export function readGitCompatibility(repo, deploySha, migrationOriginSha = SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA, manifestId = null) {
  if (!SHA.test(deploySha)) reject("deploy candidate SHA is malformed");
  const origin = migrationOriginSha;
  const authMultiuserRelease = manifestId === AUTH_MULTIUSER_MANIFEST_ID;
  const dynamicWorkoutRelease = manifestId === DYNAMIC_WORKOUT_MANIFEST_ID;
  const trainingRelease = manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID;
  try {
    git(repo, ["cat-file", "-e", `${origin}^{commit}`]);
    git(repo, ["cat-file", "-e", `${deploySha}^{commit}`]);
  } catch {
    reject("migration origin or deploy candidate commit is unavailable");
  }
  if (authMultiuserRelease) assertAuthMultiuserOriginContract(repo, origin);
  if (dynamicWorkoutRelease) assertDynamicWorkoutOriginContract(repo, origin);
  if (trainingRelease) assertTrainingMutationOriginContract(repo, origin);
  let isAncestor = false;
  try {
    git(repo, ["merge-base", "--is-ancestor", origin, deploySha]);
    isAncestor = true;
  } catch {
    isAncestor = false;
  }
  const changedPaths = git(repo, ["diff", "--name-only", "--no-renames", origin, deploySha])
    .split("\n").filter(Boolean).filter((objectPath) => {
      if (migrationOriginSha !== V4_REPUBLICATION_MIGRATION_ORIGIN_SHA || objectPath !== V4_RETIRED_WORKFLOW_PATH) return true;
      try {
        execFileSync("git", ["cat-file", "-e", `${deploySha}:${objectPath}`], { cwd: repo, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    });
  const criticalObjects = {};
  const criticalTrees = authMultiuserRelease ? AUTH_MULTIUSER_CRITICAL_TREES
    : dynamicWorkoutRelease ? DYNAMIC_WORKOUT_CRITICAL_TREES
    : trainingRelease ? TRAINING_MUTATION_LEDGER_CRITICAL_TREES : CRITICAL_TREES;
  const criticalFiles = authMultiuserRelease ? AUTH_MULTIUSER_CRITICAL_FILES
    : dynamicWorkoutRelease ? DYNAMIC_WORKOUT_CRITICAL_FILES
    : trainingRelease ? TRAINING_MUTATION_LEDGER_CRITICAL_FILES : CRITICAL_FILES;
  for (const objectPath of [...criticalTrees, ...criticalFiles]) {
    const originId = objectId(repo, origin, objectPath);
    const deployId = objectId(repo, deploySha, objectPath);
    const reviewedAuthDockerfileChange = authMultiuserRelease && objectPath === "Dockerfile"
      && originId === AUTH_MULTIUSER_CONTENT_BOUND_PATHS.Dockerfile.migrationOriginBlob
      && AUTH_MULTIUSER_CONTENT_BOUND_PATHS.Dockerfile.deployBlob === deployId;
    if (originId !== deployId && !reviewedAuthDockerfileChange) reject(`${objectPath} differs from the migration origin`);
    criticalObjects[objectPath] = originId;
  }
  const changedPathObjects = {};
  const contentBoundPaths = authMultiuserRelease ? AUTH_MULTIUSER_CONTENT_BOUND_PATHS
    : dynamicWorkoutRelease ? Object.freeze({})
    : migrationOriginSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA ? V4_CONTENT_BOUND_PATHS : CONTENT_BOUND_PATHS;
  for (const objectPath of changedPaths.filter((changed) => Object.hasOwn(contentBoundPaths, changed))) {
    changedPathObjects[objectPath] = {
      migrationOriginBlob: regularFileBlobId(repo, origin, objectPath, true),
      deployBlob: regularFileBlobId(repo, deploySha, objectPath),
    };
  }
  return { changedPaths, changedPathObjects, isAncestor, criticalObjects };
}

function readCompatibilityForMarker(repo, marker, deploySha) {
  if (marker.schemaVersion === 2 && authMultiuserSourceMarkerMatches(marker)) {
    return readGitCompatibility(repo, deploySha, marker.releaseSha, AUTH_MULTIUSER_MANIFEST_ID);
  }
  if (marker.schemaVersion === 3 && marker.manifestId === AUTH_MULTIUSER_MANIFEST_ID
    && admittedV3Marker(marker)) {
    return readGitCompatibility(repo, deploySha, marker.migrationOriginSha, AUTH_MULTIUSER_MANIFEST_ID);
  }
  if (marker.schemaVersion === 2 && marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID) {
    assertDynamicWorkoutOriginContract(repo, marker.releaseSha);
    return readGitCompatibility(repo, deploySha, marker.releaseSha, DYNAMIC_WORKOUT_MANIFEST_ID);
  }
  if (marker.schemaVersion === 3 && marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID
    && admittedV3Marker(marker)) {
    assertDynamicWorkoutOriginContract(repo, marker.migrationOriginSha);
    return readGitCompatibility(repo, deploySha, marker.migrationOriginSha, DYNAMIC_WORKOUT_MANIFEST_ID);
  }
  if (marker.schemaVersion === 2 && marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID
    && trainingMutationSourceMarkerMatches(marker)) {
    return readGitCompatibility(repo, deploySha, marker.releaseSha, TRAINING_MUTATION_LEDGER_MANIFEST_ID);
  }
  if (marker.schemaVersion === 3 && marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID
    && admittedV3Marker(marker)) {
    return readGitCompatibility(repo, deploySha, marker.migrationOriginSha, TRAINING_MUTATION_LEDGER_MANIFEST_ID);
  }
  if (marker.schemaVersion === 2 && v4SourceMarkerMatches(marker)) {
    return readGitCompatibility(repo, deploySha, V4_REPUBLICATION_MIGRATION_ORIGIN_SHA);
  }
  if (marker.schemaVersion === 3 && marker.migrationOriginSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
    && admittedV3Marker(marker)) {
    return readGitCompatibility(repo, deploySha, V4_REPUBLICATION_MIGRATION_ORIGIN_SHA);
  }
  return readGitCompatibility(repo, deploySha);
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function applySchemaDeployHandoff({ markerPath, deploySha, repo, beforeRename }) {
  const directory = path.dirname(path.resolve(markerPath));
  const details = await lstat(markerPath);
  if (!details.isFile() || details.isSymbolicLink()) reject("marker path is not a regular file");
  const current = parseSchemaDeployMarker(await readFile(markerPath));
  const exactMigrationMarker = current.marker.schemaVersion === 2
    && current.marker.manifestId === V4_REPUBLICATION_MANIFEST_ID
    && current.marker.releaseSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
    && current.marker.releaseSha === deploySha && current.marker.state === "schema-applied";
  const exactTrainingSessionContextMarker = current.marker.schemaVersion === 2
    && current.marker.manifestId === TRAINING_SESSION_CONTEXT_MANIFEST_ID
    && current.marker.releaseSha === deploySha && current.marker.state === "schema-applied";
  const compatibility = exactMigrationMarker
    ? (provenanceMatches(current.marker, V4_REPUBLICATION_HANDOFF_PROVENANCE) ? {} : reject("exact V4 migration marker provenance is invalid"))
    : exactTrainingSessionContextMarker
      ? (trainingSessionContextSourceMarkerMatches(current.marker) ? {} : reject("exact training session-context migration marker provenance is invalid"))
      : readCompatibilityForMarker(repo, current.marker, deploySha);
  const plan = evaluateSchemaDeployHandoff({ markerText: current.bytes, deploySha, ...compatibility });
  if (plan.action !== "write") return plan;
  const lockPath = `${markerPath}.lock`;
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error?.code === "EEXIST") reject("another schema deploy handoff is already active or interrupted");
    throw error;
  });
  const temporary = path.join(directory, `.marker.handoff.${process.pid}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(plan.bytes);
      await handle.sync();
    } finally { await handle.close(); }
    if (beforeRename) await beforeRename();
    const latest = parseSchemaDeployMarker(await readFile(markerPath));
    if (latest.digest !== plan.sourceDigest) reject("marker changed during compatibility handoff");
    await rename(temporary, markerPath);
    await fsyncDirectory(directory);
    return { ...plan, digest: sha256(plan.bytes) };
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

async function main() {
  const [mode, markerPath, second, third, ...remaining] = process.argv.slice(2);
  if (mode === "--validate-auth-reattest") {
    const [reportPath, deploySha, repo, workflowRunId, workflowRunAttempt, authorizationId] = [markerPath, second, third, ...remaining];
    if (![reportPath, deploySha, repo, workflowRunId, workflowRunAttempt, authorizationId].every(Boolean)) {
      reject("usage: --validate-auth-reattest <report> <deploy-sha> <repository> <run-id> <attempt> <authorization-id>");
    }
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    buildAuthSchemaReattestation({ report, deploySha, repo, workflowRunId,
      workflowRunAttempt: Number(workflowRunAttempt), authorizationId });
    return;
  }
  if (mode === "--reattest-auth") {
    const [legacyMarkerPath, reportPath, deploySha, repo, workflowRunId, workflowRunAttempt, authorizationId] = [second, third, ...remaining];
    if (![markerPath, legacyMarkerPath, reportPath, deploySha, repo, workflowRunId, workflowRunAttempt, authorizationId].every(Boolean)) {
      reject("usage: --reattest-auth <marker> <legacy-marker> <report> <deploy-sha> <repository> <run-id> <attempt> <authorization-id>");
    }
    await applyAuthSchemaReattestation({ markerPath, legacyMarkerPath, reportPath, deploySha, repo,
      workflowRunId, workflowRunAttempt: Number(workflowRunAttempt), authorizationId });
    return;
  }
  if (mode === "--check" || mode === "--apply") {
    const deploySha = second;
    const repo = third || process.cwd();
    if (mode === "--check") {
      const markerText = await readFile(markerPath);
      const marker = parseSchemaDeployMarker(markerText).marker;
      const exactMigrationMarker = marker.schemaVersion === 2
        && marker.manifestId === V4_REPUBLICATION_MANIFEST_ID
        && marker.releaseSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
        && marker.releaseSha === deploySha && marker.state === "schema-applied";
      const exactTrainingSessionContextMarker = marker.schemaVersion === 2
        && marker.manifestId === TRAINING_SESSION_CONTEXT_MANIFEST_ID
        && marker.releaseSha === deploySha && marker.state === "schema-applied";
      const compatibility = exactMigrationMarker
        ? (provenanceMatches(marker, V4_REPUBLICATION_HANDOFF_PROVENANCE) ? {} : reject("exact V4 migration marker provenance is invalid"))
        : exactTrainingSessionContextMarker
          ? (trainingSessionContextSourceMarkerMatches(marker) ? {} : reject("exact training session-context migration marker provenance is invalid"))
          : readCompatibilityForMarker(repo, marker, deploySha);
      evaluateSchemaDeployHandoff({ markerText, deploySha, ...compatibility });
      return;
    }
    await applySchemaDeployHandoff({ markerPath, deploySha, repo });
    return;
  }
  if (mode === "--render-transition") {
    process.stdout.write(renderSchemaDeployTransition(await readFile(markerPath), second));
    return;
  }
  if (mode === "--validate-marker") {
    validateSchemaDeployHandoffMarker(await readFile(markerPath));
    return;
  }
  if (mode === "--validate-training-capture-marker") {
    const [preflightResultPath, expectedReleaseSha, liveAppSha, repo] = [second, third, ...remaining];
    if (![markerPath, preflightResultPath, expectedReleaseSha, liveAppSha, repo].every(Boolean)) {
      reject("usage: --validate-training-capture-marker <marker> <preflight-result> <release-sha> <live-app-sha> <repository>");
    }
    const preflightResult = JSON.parse(await readFile(preflightResultPath, "utf8"));
    validateTrainingCaptureMarkerWitness({
      markerText: await readFile(markerPath, "utf8"), preflightResult, expectedReleaseSha, liveAppSha, repositoryPath: repo,
    });
    return;
  }
  reject(`unknown mode ${mode ?? ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
