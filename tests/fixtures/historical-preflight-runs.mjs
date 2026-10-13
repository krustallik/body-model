const historicalAuthorizationRetryIdentities = [
  [38379375890, "aac9e9c3504f6cd88bba9ca9d90cd8ec2905e839"],
  [38379548326, "aac9e9c3504f6cd88bba9ca9d90cd8ec2905e839"],
  [38384779107, "029bbe81a341abe2e8642564b8c4fa2e0b3f00a8"],
  [38396593728, "fce2329260599e566ee9c36a7bcf3ceb1dfab3d2"],
  [38399644888, "f0d08f646c8c0cb3d2b9fa748d548e93da6d3681"],
  [38403898937, "6a30660f9fd12807aefd23953aa32d778a9fe3a0"],
  [38410773609, "6cf8b872e7a85af9959beac63b2abc81ad7bc477"],
  [38413249982, "bf481a853b419e369643bd0c1eed0aa00fa6d724"],
  [38415354392, "df87ca5cf873fa46acf9123bb1feb61fce530bba"],
  [38417627284, "7d7fe53be3d4fbee211291bcefe45e7dfdbc3b28"],
];

const authorizationRetrySteps = [
  ["Set up job", "success"],
  ["Checkout current main tooling", "success"],
  ["Validate canonical repository, exact main, and successful CI", "failure"],
  ["Post Checkout current main tooling", "success"],
  ["Complete job", "success"],
].map(([name, conclusion]) => ({ name, conclusion, status: "completed" }));

export const historicalAuthorizationRetries = historicalAuthorizationRetryIdentities.map(([id, sha]) => ({
  run: {
    id, workflow_id: 372102614,
    path: ".github/workflows/production-migration-preflight.yml@refs/heads/main",
    event: "workflow_dispatch", head_branch: "main", head_sha: sha,
    status: "completed", conclusion: "failure", run_attempt: 1,
    display_title: `Preflight ${sha} unified-v4-republication-v1`,
    actor: { id: 126446430 }, triggering_actor: { id: 126446430 },
    repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
  },
  jobs: { total_count: 2, jobs: [
    { name: "Authorize read-only preflight", status: "completed", conclusion: "failure", head_sha: sha, run_attempt: 1,
      steps: authorizationRetrySteps.map((step) => ({ ...step })) },
    { name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL", status: "completed", conclusion: "skipped",
      head_sha: sha, run_attempt: 1, steps: [] },
  ] },
  artifacts: { total_count: 0, artifacts: [] },
}));

export const successfulHistoricalNoAppPreparation = {
  "run": {
    "id": 38384990861,
    "workflow_id": 382319718,
    "path": ".github/workflows/production-no-app-preflight.yml",
    "event": "workflow_dispatch",
    "head_branch": "main",
    "head_sha": "029bbe81a341abe2e8642564b8c4fa2e0b3f00a8",
    "status": "completed",
    "conclusion": "success",
    "run_attempt": 1,
    "display_title": "No-app prep 029bbe81a341abe2e8642564b8c4fa2e0b3f00a8 unified-v4-republication-v1",
    "actor": {
      "id": 126446430
    },
    "triggering_actor": {
      "id": 126446430
    },
    "repository": {
      "full_name": "krustallik/body-model",
      "owner": {
        "id": 126446430,
        "login": "krustallik"
      }
    }
  },
  "jobs": {
    "total_count": 2,
    "jobs": [
      {
        "name": "Authorize exact-main no-app preparation",
        "conclusion": "success",
        "head_sha": "029bbe81a341abe2e8642564b8c4fa2e0b3f00a8",
        "run_attempt": 1,
        "steps": [
          {
            "name": "Set up job",
            "conclusion": "success"
          },
          {
            "name": "Checkout exact current main tooling",
            "conclusion": "success"
          },
          {
            "name": "Verify owner, confirmation, exact current main, and successful CI",
            "conclusion": "success"
          },
          {
            "name": "Post Checkout exact current main tooling",
            "conclusion": "success"
          },
          {
            "name": "Complete job",
            "conclusion": "success"
          }
        ]
      },
      {
        "name": "Read-only snapshot and isolated backup rehearsal",
        "conclusion": "success",
        "head_sha": "029bbe81a341abe2e8642564b8c4fa2e0b3f00a8",
        "run_attempt": 1,
        "steps": [
          {
            "name": "Set up job",
            "conclusion": "success"
          },
          {
            "name": "Initialize containers",
            "conclusion": "success"
          },
          {
            "name": "Checkout exact current-main release SHA",
            "conclusion": "success"
          },
          {
            "name": "Set up pinned Node runtime",
            "conclusion": "success"
          },
          {
            "name": "Install locked tooling",
            "conclusion": "success"
          },
          {
            "name": "Recheck trusted owner workflow attempt before production credentials",
            "conclusion": "success"
          },
          {
            "name": "Verify exact main, source run identity, and active production workflows",
            "conclusion": "success"
          },
          {
            "name": "Validate production SSH and backup credentials",
            "conclusion": "success"
          },
          {
            "name": "Pin production SSH host key",
            "conclusion": "success"
          },
          {
            "name": "Recheck exact main, capture history, and competing runs immediately before read-only snapshot",
            "conclusion": "success"
          },
          {
            "name": "Create fresh encrypted backup under the host release lock",
            "conclusion": "success"
          },
          {
            "name": "Restore backup and verify identity, schema, history, and data on isolated PostgreSQL",
            "conclusion": "success"
          },
          {
            "name": "Rehearse exact V4 migrations only on isolated PostgreSQL",
            "conclusion": "success"
          },
          {
            "name": "Recheck exact main and create preparation-only evidence",
            "conclusion": "success"
          },
          {
            "name": "Upload encrypted production backup",
            "conclusion": "success"
          },
          {
            "name": "Upload immutable database-only preparation evidence",
            "conclusion": "success"
          },
          {
            "name": "Remove temporary SSH credentials",
            "conclusion": "success"
          },
          {
            "name": "Post Set up pinned Node runtime",
            "conclusion": "success"
          },
          {
            "name": "Post Checkout exact current-main release SHA",
            "conclusion": "success"
          },
          {
            "name": "Stop containers",
            "conclusion": "success"
          },
          {
            "name": "Complete job",
            "conclusion": "success"
          }
        ]
      }
    ]
  },
  "artifacts": {
    "total_count": 2,
    "artifacts": [
      {
        "id": 11805421475,
        "name": "bodycast-no-app-backup-029bbe81a341abe2e8642564b8c4fa2e0b3f00a8-unified-v4-republication-v1-38384990861-1",
        "size_in_bytes": 62035386,
        "expired": false,
        "digest": "sha256:714b30245ea49bd8126a8ceda7a7bd7e6cd4652784deee00204037b0d086eb2e"
      },
      {
        "id": 11804819744,
        "name": "bodycast-no-app-preparation-029bbe81a341abe2e8642564b8c4fa2e0b3f00a8-unified-v4-republication-v1-38384990861-1",
        "size_in_bytes": 28245,
        "expired": false,
        "digest": "sha256:5004d86e996e5fc452c19fcdb34b7419feb0e0f9f97294f9a4a8786fb0240b60"
      }
    ]
  }
};

export const failedHistoricalNoAppAfterRehearsal = {
  "run": {
    "id": 38375009197,
    "workflow_id": 382319718,
    "path": ".github/workflows/production-no-app-preflight.yml",
    "event": "workflow_dispatch",
    "head_branch": "main",
    "head_sha": "4262ec1921d7501db1a0f898ed6347c57c2611e8",
    "status": "completed",
    "conclusion": "failure",
    "run_attempt": 1,
    "display_title": "No-app prep 4262ec1921d7501db1a0f898ed6347c57c2611e8 unified-v4-republication-v1",
    "actor": {
      "id": 126446430
    },
    "triggering_actor": {
      "id": 126446430
    },
    "repository": {
      "full_name": "krustallik/body-model",
      "owner": {
        "id": 126446430,
        "login": "krustallik"
      }
    }
  },
  "jobs": {
    "total_count": 2,
    "jobs": [
      {
        "name": "Authorize exact-main no-app preparation",
        "conclusion": "success",
        "head_sha": "4262ec1921d7501db1a0f898ed6347c57c2611e8",
        "run_attempt": 1,
        "steps": [
          {
            "name": "Set up job",
            "conclusion": "success"
          },
          {
            "name": "Checkout exact current main tooling",
            "conclusion": "success"
          },
          {
            "name": "Verify owner, confirmation, exact current main, and successful CI",
            "conclusion": "success"
          },
          {
            "name": "Post Checkout exact current main tooling",
            "conclusion": "success"
          },
          {
            "name": "Complete job",
            "conclusion": "success"
          }
        ]
      },
      {
        "name": "Read-only snapshot and isolated backup rehearsal",
        "conclusion": "failure",
        "head_sha": "4262ec1921d7501db1a0f898ed6347c57c2611e8",
        "run_attempt": 1,
        "steps": [
          {
            "name": "Set up job",
            "conclusion": "success"
          },
          {
            "name": "Initialize containers",
            "conclusion": "success"
          },
          {
            "name": "Checkout exact current-main release SHA",
            "conclusion": "success"
          },
          {
            "name": "Set up pinned Node runtime",
            "conclusion": "success"
          },
          {
            "name": "Install locked tooling",
            "conclusion": "success"
          },
          {
            "name": "Recheck trusted owner workflow attempt before production credentials",
            "conclusion": "success"
          },
          {
            "name": "Verify exact main, source run identity, and active production workflows",
            "conclusion": "success"
          },
          {
            "name": "Validate production SSH and backup credentials",
            "conclusion": "success"
          },
          {
            "name": "Pin production SSH host key",
            "conclusion": "success"
          },
          {
            "name": "Recheck exact main, capture history, and competing runs immediately before read-only snapshot",
            "conclusion": "success"
          },
          {
            "name": "Create fresh encrypted backup under the host release lock",
            "conclusion": "success"
          },
          {
            "name": "Restore backup and verify identity, schema, history, and data on isolated PostgreSQL",
            "conclusion": "success"
          },
          {
            "name": "Rehearse exact V4 migrations only on isolated PostgreSQL",
            "conclusion": "success"
          },
          {
            "name": "Recheck exact main and create preparation-only evidence",
            "conclusion": "failure"
          },
          {
            "name": "Upload encrypted production backup",
            "conclusion": "skipped"
          },
          {
            "name": "Upload immutable database-only preparation evidence",
            "conclusion": "skipped"
          },
          {
            "name": "Remove temporary SSH credentials",
            "conclusion": "success"
          },
          {
            "name": "Post Set up pinned Node runtime",
            "conclusion": "skipped"
          },
          {
            "name": "Post Checkout exact current-main release SHA",
            "conclusion": "success"
          },
          {
            "name": "Stop containers",
            "conclusion": "success"
          },
          {
            "name": "Complete job",
            "conclusion": "success"
          }
        ]
      }
    ]
  },
  "artifacts": {
    "total_count": 0,
    "artifacts": []
  }
};
