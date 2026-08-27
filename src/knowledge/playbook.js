import catalog from "../../knowledge-authoring/catalog/AI_Governance_Tactic_Playbook_v1.0.0.json" with { type: "json" };

const APPROVED_STATUSES = new Set(["APPROVED", "FROZEN"]);
const array = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values)];

export const PLAYBOOK_CATALOG_ID = catalog.catalog_id;
export const PLAYBOOK_VERSION = catalog.version;
export const PLAYBOOK_RELEASE_STATUS = catalog.release_status;

export function runtimeTacticsFromCatalog(tactics, catalogReleaseStatus) {
  return array(tactics).map((item) => ({
    id: item.id,
    version: item.version,
    status: APPROVED_STATUSES.has(item.release_status) && APPROVED_STATUSES.has(catalogReleaseStatus) ? "APPROVED" : item.release_status,
    title: item.title,
    function: item.function,
    controlPurpose: item.control_purpose,
    primaryMappingText: item.primary_mapping_text,
    findingSignals: [],
    domains: unique([...array(item.assessment_mappings?.capabilities), ...array(item.assessment_mappings?.antipatterns)].map((id) => id.replace(/^AP-/, "").charAt(0))),
    lifecycleStages: item.eligibility?.lifecycle_stages ?? [],
    useWhen: item.use_when ?? item.control_purpose,
    doNotUseWhen: item.do_not_use_when ?? [],
    ownerRoles: item.owners ?? [],
    activities: item.activities ?? [item.control_purpose],
    requiredArtifacts: item.artifacts ?? item.principal_outputs,
    principalOutputs: item.principal_outputs,
    acceptanceCriteria: item.acceptance_criteria ?? [],
    verification: item.verification ?? ["Implementation must produce evidence for verification and reassessment."],
    risks: item.risks ?? [],
    blocksTransition: item.blocks_transition ?? "No transition is authorized by tactic selection or completion.",
    completionEffect: item.completion_effect,
    assessmentMappings: item.assessment_mappings,
    eligibleFindingIds: item.eligible_finding_ids,
    triggerStates: item.trigger_states,
    prerequisiteTacticIds: item.prerequisite_tactic_ids,
    reassessmentText: item.reassessment_text,
    reassessmentTargets: item.reassessment_targets,
    normativeSourceMappings: item.normative_source_mappings
  })).sort((a, b) => a.id.localeCompare(b.id));
}

export const TACTICS = Object.freeze(runtimeTacticsFromCatalog(catalog.tactics, catalog.release_status));
