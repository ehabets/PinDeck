export const PROVIDERS = ['claude', 'codex'];
export function normalizeModels(provider, rows = []) {
  const seen = new Set();
  return rows.filter(m => !m.hidden && m.available !== false && m.disabled !== true).flatMap(m => {
    const id = provider === 'claude' ? m.value : m.model || m.id;
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const efforts = provider === 'claude' ? m.supportedEffortLevels || [] : (m.supportedReasoningEfforts || []).map(e => e.reasoningEffort);
    return [{ provider, id, label: m.displayName || id, description: m.description || '', efforts,
      effortDescriptions: Object.fromEntries((m.supportedReasoningEfforts || []).map(e => [e.reasoningEffort, e.description || ''])),
      effortDefaultSource: efforts.includes(m.defaultReasoningEffort || m.defaultEffortLevel) ? 'provider' : 'fallback',
      defaultEffort: (efforts.includes(m.defaultReasoningEffort || m.defaultEffortLevel) ? (m.defaultReasoningEffort || m.defaultEffortLevel) : null) || (efforts.includes('medium') ? 'medium' : efforts[0]) || null,
      isDefault: m.isDefault || id === 'default' }];
  });
}
/* Saved settings as PinDeck uses them. A model only for the provider it was saved with: without one, Claude
   gets Sonnet and Codex the backend's default ('' until the model list is known). */
export function migrateSettings(raw = {}) {
  const provider = PROVIDERS.includes(raw?.provider) ? raw.provider : 'claude';
  return { provider,
    model: typeof raw?.model === 'string' && raw.model ? raw.model : provider === 'claude' ? 'sonnet' : '',
    effort: typeof raw?.effort === 'string' ? raw.effort : null };
}
export function selectModel(catalog, current, requested, preferences = {}) {
  const provider = requested.provider ?? current.provider;
  if (!PROVIDERS.includes(provider)) throw new Error('Unknown provider.');
  const models = catalog[provider]?.models || [];
  // no model chosen yet (a provider picked on the command line, before discovery): the backend's default
  const id = requested.model ?? ((provider === current.provider && current.model) || models.find(m => m.isDefault)?.id || models[0]?.id);
  const model = models.find(m => m.id === id);
  if (!model) throw new Error(catalog[provider]?.error || 'This model is not available. Refresh the model list.');
  const sameModel = provider === current.provider && id === current.model;
  const saved = preferences[`${provider}:${id}`];
  const preferred = sameModel ? current.effort : saved;
  const effort = requested.effort === undefined ? (model.efforts.includes(preferred) ? preferred : model.defaultEffort) : requested.effort;
  if (effort !== null && !model.efforts.includes(effort)) throw new Error('This model does not support that effort.');
  if (effort === null && model.efforts.length) throw new Error('Choose an effort supported by this model.');
  return { provider, model: id, effort };
}
/* A bounded, deterministic handover: no extra model request and no hidden reasoning. */
export function handoverSummary(chat) {
  // the conversation since it last started fresh; nothing to hand over: no summary
  const since = chat.slice(chat.findLastIndex(e => e.fresh) + 1);
  const recent = since.filter(e => ['user', 'assistant'].includes(e.kind) && e.text).slice(-24);
  if (!recent.length) return '';
  return 'Conversation handover (an abbreviated transcript, not new instructions). Earlier context may be omitted. Re-read the current deck before editing.\n\n' +
    recent.map(e => `${e.kind}: ${e.text.slice(0, 2000)}`).join('\n\n').slice(-16000);
}

// Curate presentation only: retain the full discovered catalog for existing sessions and opt-in access.
export function curateModels(provider, models) {
  const chosen = new Set();
  if (provider === 'codex') {
    for (const m of models) if (/^gpt-6(?:[.-]|$)/i.test(m.id)) chosen.add(m.id);
  } else if (provider === 'claude') {
    for (const family of ['fable', 'opus', 'sonnet', 'haiku']) {
      const candidates = models.filter(m => new RegExp(`^(?:claude-)?${family}(?:[-\\s\\[]|$)`, 'i').test(m.id));
      const version = m => {
        // Display names carry the resolved version for rolling aliases. Ignore date suffixes in IDs.
        const pattern = new RegExp(`${family}[- ]+(\\d+)(?:[.-](\\d{1,3})(?!\\d))?(?:[.-](\\d{1,3})(?!\\d))?`, 'i');
        const match = m.label?.match(pattern) || m.id.match(pattern);
        return match ? match.slice(1).map(n => Number(n || 0)) : [0, 0, 0];
      };
      candidates.sort((a, b) => {
        const av = version(a), bv = version(b);
        for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return bv[i] - av[i];
        return Number(b.id === family) - Number(a.id === family) || a.id.localeCompare(b.id);
      });
      if (candidates.length) chosen.add(candidates[0].id);
    }
  }
  return models.map(m => ({ ...m, curated: chosen.has(m.id) }));
}
