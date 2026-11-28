// Independently specified browser HTTP response for an editable Config and a destructive Label plan.
// The UI and browser service consume this wire contract; no Playground controller is involved.
export function configSnapshot(configText = 'namespaces:\n  status: [todo]\n') {
  return {
    state: 'sync_pending', branch: 'main', headSha: 'a'.repeat(40),
    fileSha: 'b'.repeat(40), configText,
    config: { state: 'ready', namespaces: { status: ['status:todo'] } },
    snapshotId: 'c'.repeat(64), counts: { labels: 4, issueObjects: 24 },
    plan: {
      createLabels: [{ name: 'status:review' }],
      removeIssueLabels: [{ number: 12, labels: ['status:obsolete'] }],
      impact: { definitions: 1, issues: 1, removals: 1 },
      hasChanges: true, requiresConfirmation: true,
    },
    capability: {
      state: 'ready', user: { login: 'fixture-operator', id: 123 },
      userPermissions: { pull: true, triage: true, push: true, maintain: false, admin: false },
      appPermissions: { contents: 'write', issues: 'write', pull_requests: 'write' },
      protectedBranch: true, canSaveConfig: true, canCreateLabels: true, canRemoveLabels: true,
    },
  }
}
