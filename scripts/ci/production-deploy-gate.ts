export type DeployGateInput = {
  eventName: string;
  repositoryFullName: string;
  mainTipSha: string;
  candidateSha: string;
  dispatchConfirm?: string | null;
  nonServingDeploy?: boolean;
};

export type DeployGateResult = {
  decision: "deploy" | "block" | "skip";
  reason: string;
  candidateSha: string | null;
};

const FULL_SHA = /^[0-9a-f]{40}$/;

/** Compare a candidate against a freshly observed canonical refs/heads/main commit. */
export function isCurrentMainSha(candidateSha: string, observedMainSha: string): boolean {
  return FULL_SHA.test(candidateSha) && FULL_SHA.test(observedMainSha) && candidateSha === observedMainSha;
}

/** The incompatible-schema release is manual, owner-gated, and always non-serving. */
export function evaluateProductionDeployGate(input: DeployGateInput): DeployGateResult {
  if (input.repositoryFullName !== "krustallik/body-model") {
    return { decision: "block", reason: "Production deployment is allowed only from the canonical BodyCast repository.", candidateSha: null };
  }
  if (input.eventName !== "workflow_dispatch") {
    return { decision: "block", reason: "Production deployment requires an explicit manual workflow dispatch.", candidateSha: null };
  }
  if (input.dispatchConfirm !== "deploy") {
    return { decision: "block", reason: "Manual deploy requires confirm_production_deploy=deploy.", candidateSha: null };
  }
  if (input.nonServingDeploy !== true) {
    return { decision: "block", reason: "This schema release must deploy in non-serving mode until rollout gates pass.", candidateSha: null };
  }
  if (!FULL_SHA.test(input.candidateSha)) {
    return { decision: "block", reason: "Manual deploy requires a full 40-character candidate SHA.", candidateSha: null };
  }
  if (!isCurrentMainSha(input.candidateSha, input.mainTipSha)) {
    return { decision: "skip", reason: `Candidate ${input.candidateSha} is not current canonical main tip ${input.mainTipSha}.`, candidateSha: input.candidateSha };
  }
  return { decision: "deploy", reason: "Owner-authorized non-serving deploy is bound to the exact current main SHA.", candidateSha: input.candidateSha };
}
