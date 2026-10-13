export const historicalAuthorizationRetries = [
  {
    run: {
      id: 38379375890, workflow_id: 372102614,
      path: ".github/workflows/production-migration-preflight.yml@refs/heads/main",
      event: "workflow_dispatch", head_branch: "main", head_sha: "aac9e9c3504f6cd88bba9ca9d90cd8ec2905e839",
      status: "completed", conclusion: "failure", run_attempt: 1,
      display_title: "Preflight aac9e9c3504f6cd88bba9ca9d90cd8ec2905e839 unified-v4-republication-v1",
      actor: { id: 126446430 }, triggering_actor: { id: 126446430 },
      repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
    },
    jobs: { total_count: 2, jobs: [
      { name: "Authorize read-only preflight", conclusion: "failure", head_sha: "aac9e9c3504f6cd88bba9ca9d90cd8ec2905e839", run_attempt: 1,
        steps: [{ name: "Set up job", conclusion: "success" }, { name: "Checkout current main tooling", conclusion: "success" },
          { name: "Validate canonical repository, exact main, and successful CI", conclusion: "failure" },
          { name: "Post Checkout current main tooling", conclusion: "success" }, { name: "Complete job", conclusion: "success" }] },
      { name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL", conclusion: "skipped", head_sha: "aac9e9c3504f6cd88bba9ca9d90cd8ec2905e839", run_attempt: 1, steps: [] },
    ] },
    artifacts: { total_count: 0, artifacts: [] },
  },
  {
    run: {
      id: 38379548326, workflow_id: 372102614,
      path: ".github/workflows/production-migration-preflight.yml@refs/heads/main",
      event: "workflow_dispatch", head_branch: "main", head_sha: "aac9e9c3504f6cd88bba9ca9d90cd8ec2905e839",
      status: "completed", conclusion: "failure", run_attempt: 1,
      display_title: "Preflight aac9e9c3504f6cd88bba9ca9d90cd8ec2905e839 unified-v4-republication-v1",
      actor: { id: 126446430 }, triggering_actor: { id: 126446430 },
      repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
    },
    jobs: { total_count: 2, jobs: [
      { name: "Authorize read-only preflight", conclusion: "failure", head_sha: "aac9e9c3504f6cd88bba9ca9d90cd8ec2905e839", run_attempt: 1,
        steps: [{ name: "Set up job", conclusion: "success" }, { name: "Checkout current main tooling", conclusion: "success" },
          { name: "Validate canonical repository, exact main, and successful CI", conclusion: "failure" },
          { name: "Post Checkout current main tooling", conclusion: "success" }, { name: "Complete job", conclusion: "success" }] },
      { name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL", conclusion: "skipped", head_sha: "aac9e9c3504f6cd88bba9ca9d90cd8ec2905e839", run_attempt: 1, steps: [] },
    ] },
    artifacts: { total_count: 0, artifacts: [] },
  },
  {
    run: {
      id: 38384779107, workflow_id: 372102614,
      path: ".github/workflows/production-migration-preflight.yml@refs/heads/main",
      event: "workflow_dispatch", head_branch: "main", head_sha: "029bbe81a341abe2e8642564b8c4fa2e0b3f00a8",
      status: "completed", conclusion: "failure", run_attempt: 1,
      display_title: "Preflight 029bbe81a341abe2e8642564b8c4fa2e0b3f00a8 unified-v4-republication-v1",
      actor: { id: 126446430 }, triggering_actor: { id: 126446430 },
      repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
    },
    jobs: { total_count: 2, jobs: [
      { name: "Authorize read-only preflight", conclusion: "failure", head_sha: "029bbe81a341abe2e8642564b8c4fa2e0b3f00a8", run_attempt: 1,
        steps: [{ name: "Set up job", conclusion: "success" }, { name: "Checkout current main tooling", conclusion: "success" },
          { name: "Validate canonical repository, exact main, and successful CI", conclusion: "failure" },
          { name: "Post Checkout current main tooling", conclusion: "success" }, { name: "Complete job", conclusion: "success" }] },
      { name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL", conclusion: "skipped", head_sha: "029bbe81a341abe2e8642564b8c4fa2e0b3f00a8", run_attempt: 1, steps: [] },
    ] },
    artifacts: { total_count: 0, artifacts: [] },
  },
];

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
