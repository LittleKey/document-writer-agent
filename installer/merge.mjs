// Additive overlay merge for .opencode/oh-my-opencode-slim.json
//
// Rules (documented in INSTALL.md):
// - The installer manages exactly two keys: agents["document-writer"] and
//   agents["lark-operator"]. Those entries are replaced wholesale.
// - Every other SEMANTIC VALUE of target-managed configuration is preserved:
//   unknown top-level keys, other agents, presets, and unknown keys inside the
//   two managed entries are kept; only the keys the shipped overlay defines
//   are set. The merged result is re-serialized (2-space JSON + trailing
//   newline), so the original byte layout — whitespace, formatting, key
//   duplication — is not preserved. Only non-overlay files are byte-exact.
// - .jsonc is never rewritten (comment-preserving merge is out of scope); a
//   pre-existing project .jsonc is reported as a conflict instead.

export const MANAGED_AGENT_KEYS = ["document-writer", "lark-operator"];

export function overlayConflictReason({ existingJson, existingJsonc }) {
  if (existingJsonc && !existingJson) {
    return `project oh-my-opencode-slim.jsonc exists; .jsonc wins over .json in the plugin's config resolution, so an additive .json install would be shadowed. Merge the fragment into the .jsonc manually.`;
  }
  return null;
}

/**
 * Deep-merge the shipped overlay onto a parsed existing config object.
 * Returns a NEW object; inputs are not mutated.
 */
export function mergeOverlay(existing, shipped) {
  const result = structuredClone(existing ?? {});
  const shippedAgents = shipped.agents ?? {};
  const agents = { ...(result.agents ?? {}) };

  for (const key of Object.keys(shippedAgents)) {
    const prev = agents[key];
    if (prev && typeof prev === "object" && !Array.isArray(prev)) {
      // keep unknown keys the target added inside a managed entry
      agents[key] = { ...structuredClone(prev), ...structuredClone(shippedAgents[key]) };
    } else {
      agents[key] = structuredClone(shippedAgents[key]);
    }
  }
  result.agents = agents;
  return result;
}

/** Remove the managed agent entries; returns null when nothing would remain. */
export function unmergeOverlay(existing) {
  const result = structuredClone(existing ?? {});
  const agents = { ...(result.agents ?? {}) };
  let removed = false;
  for (const key of MANAGED_AGENT_KEYS) {
    if (key in agents) {
      delete agents[key];
      removed = true;
    }
  }
  if (!removed) return { next: result, removed };
  if (Object.keys(agents).length === 0) delete result.agents;
  else result.agents = agents;
  if (Object.keys(result).length === 0) return { next: null, removed };
  return { next: result, removed };
}

export function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
