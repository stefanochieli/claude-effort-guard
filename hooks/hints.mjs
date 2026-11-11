// Texts effort-guard hands to the model: pure, so they are tested on their own.

// What a compaction should keep: the command that kept failing, the narrow
// rerun and the files changed recently. Null when there is nothing to add.
export function buildCompactHint(m) {
  if (!m) {
    return null
  }

  const lines = []
  if (m.consecutiveStruggles > 0 && m.lastStruggleCommand) {
    lines.push(
      `The last ${m.consecutiveStruggles} turn(s) failed (${m.lastStruggleReason ?? 'failure'}) on: ${m.lastStruggleCommand}. Keep that command, the error it printed and what was already tried.`,
    )
  }
  if (m.rerunHint) {
    lines.push(`Narrow rerun for the failing tests: ${m.rerunHint}`)
  }
  if (Array.isArray(m.touchedFiles) && m.touchedFiles.length > 0) {
    lines.push(`Files changed recently, keep their paths: ${m.touchedFiles.join(', ')}`)
  }

  return lines.length > 0 ? `effort-guard:\n- ${lines.join('\n- ')}` : null
}

// Appends the hint to what the person asked /compact to stress, if anything.
export function withCompactHint(instructions, hint) {
  if (!hint) {
    return instructions
  }

  return instructions ? `${instructions}\n\n${hint}` : hint
}

// The system-prompt section asking the model to change approach.
export function buildSelfCorrect(m) {
  return [
    `The last ${m.consecutiveStruggles} turns failed${m.lastStruggleReason ? ` (${m.lastStruggleReason})` : ''}${m.lastStruggleCommand ? ` on \`${m.lastStruggleCommand}\`` : ''}.`,
    'Stop retrying the same step. Re-read the files involved before editing them, state what you think the cause is, and change approach.',
    m.rerunHint ? `Run only the failing tests: \`${m.rerunHint}\`.` : 'Run only the failing test, not the whole build.',
  ].join(' ')
}
