type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

export interface ModelRefLike {
  providerID?: string;
  modelID?: string;
  id?: string;
}

/** Model of the most recent assistant message (v2: `message.model.{providerID,id}`, v1: `providerID/modelID` on the message). */
export function lastAssistantModel(
  messages: readonly unknown[] | undefined,
): ModelRefLike | undefined {
  const list = messages ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!isObj(m)) continue;
    const role = m.role ?? m.type;
    if (role !== "assistant") continue;
    if (isObj(m.model))
      return {
        providerID: m.model.providerID,
        modelID: m.model.id ?? m.model.modelID,
      };
    if (m.providerID && m.modelID)
      return { providerID: m.providerID, modelID: m.modelID };
  }
  return undefined;
}

/** Context window (tokens) for a model reference within a model/provider list; undefined if unknown. */
export function contextLimitFor(
  ref: ModelRefLike | undefined,
  models: readonly unknown[] | undefined,
): number | undefined {
  if (!ref?.modelID) return undefined;
  for (const m of models ?? []) {
    if (!isObj(m)) continue;
    if (m.id !== ref.modelID) continue;
    if (
      ref.providerID &&
      m.providerID !== undefined &&
      m.providerID !== ref.providerID
    )
      continue;
    const limit = m.limit?.context;
    if (typeof limit === "number" && limit > 0) return limit;
  }
  return undefined;
}
