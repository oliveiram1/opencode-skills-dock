/**
 * skills-sidebar — OpenCode 2.x TUI plugin.
 *
 * Adds a "Skills" section to the session sidebar (`sidebar.content` slot), modelled on the built-in MCP section:
 * switchable skill groups, per-session usage, and an estimated context-window share.
 *
 * Loaded directly as .tsx: OpenCode installs the OpenTUI Solid transform for external plugin files and maps
 * `@opentui/solid` / `solid-js` to the host's own copies, so no build step is needed.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import { homedir } from "node:os";
import { contextLimitFor, lastAssistantModel } from "./src/context";
import { formatTokenSummary } from "./src/estimate";
import {
  buildGroups,
  displayGroups,
  GROUPING_MODES,
  normalizeSkills,
  parseGroupingMode,
  type GroupingMode,
  type SkillRow,
} from "./src/skills";
import { deriveUsage } from "./src/usage";
import {
  createProvenanceResolver,
  resolveCurrentSkills,
} from "./src/provenance";

/** Minimal structural view of the OpenCode 2.x TUI plugin context (types are not published). */
interface Host {
  location?: { directory?: string; workspaceID?: string };
  theme: any;
  data: any;
  client?: any;
  renderer: { copyToClipboardOSC52: (text: string) => boolean };
  storage?: {
    store: (
      key: string,
      opts: { initial: any },
    ) => [any, (fn: (draft: any) => void) => Promise<unknown>];
  };
  ui: {
    slot: (claim: {
      append?: string;
      render: (props: any) => any;
    }) => () => void;
    model?: {
      current?: () => { providerID?: string; modelID?: string } | undefined;
    };
    dialog: {
      select: (input: {
        title: string;
        options: { title: string; value: string; description?: string }[];
      }) => Promise<string | undefined>;
      confirm: (input: {
        title: string;
        message: string;
        label?: { confirm: string; cancel: string };
      }) => Promise<boolean | undefined>;
    };
    toast: {
      show: (input: { message: string; variant?: "success" | "error" }) => void;
    };
  };
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const safe = <T,>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

function SkillsSection(props: { ctx: Host; sessionID: string }) {
  const ctx = props.ctx;
  const theme = () => ctx.theme;

  // Persisted open/closed state like the built-in sections; degrade to a plain signal if storage is unavailable.
  const stored = safe(() =>
    ctx.storage?.store("view", { initial: { open: true } }),
  );
  const [localOpen, setLocalOpen] = createSignal(true);
  const open = () => (stored ? stored[0].open !== false : localOpen());
  const toggle = () => {
    if (!stored) return setLocalOpen((v) => !v);
    stored[1]((d) => {
      d.open = !d.open;
    }).catch(() => setLocalOpen((v) => !v));
  };
  const groupingStore = safe(() =>
    ctx.storage?.store("grouping", {
      initial: { mode: "none", hideInactive: false },
    }),
  );
  const [localGrouping, setLocalGrouping] = createSignal<GroupingMode>();
  const grouping = () =>
    localGrouping() ?? parseGroupingMode(groupingStore?.[0].mode);
  const [localHideInactive, setLocalHideInactive] = createSignal<boolean>();
  const hideInactive = () =>
    localHideInactive() ?? groupingStore?.[0].hideInactive === true;
  let groupingRevision = 0;
  let hideInactiveRevision = 0;
  let groupingWrites: Promise<unknown> = Promise.resolve();
  const selectGrouping = (mode: GroupingMode) => {
    const revision = ++groupingRevision;
    setLocalGrouping(mode);
    if (!groupingStore) return;
    groupingWrites = groupingWrites
      .catch(() => undefined)
      .then(() =>
        groupingStore[1]((draft) => {
          draft.mode = mode;
        }),
      );
    void groupingWrites
      .then(() => {
        if (revision === groupingRevision) setLocalGrouping(undefined);
      })
      .catch(() => {
        if (revision === groupingRevision) {
          ctx.ui.toast.show({
            message: "Grouping changed, but could not be saved.",
            variant: "error",
          });
        }
      });
  };
  const selectHideInactive = (value: boolean) => {
    const revision = ++hideInactiveRevision;
    setLocalHideInactive(value);
    if (!groupingStore) return;
    groupingWrites = groupingWrites
      .catch(() => undefined)
      .then(() =>
        groupingStore[1]((draft) => {
          draft.hideInactive = value;
        }),
      );
    void groupingWrites
      .then(() => {
        if (revision === hideInactiveRevision) setLocalHideInactive(undefined);
      })
      .catch(() => {
        if (revision === hideInactiveRevision) {
          ctx.ui.toast.show({
            message: "Filter changed, but could not be saved.",
            variant: "error",
          });
        }
      });
  };
  const [closedGroups, setClosedGroups] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  const toggleGroup = (key: string) =>
    setClosedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const session = createMemo(() =>
    safe(() => ctx.data.session.get(props.sessionID)),
  );
  const location = () => session()?.location ?? ctx.location;

  // Catalogue: host data store first (auto-updates on `skill.updated`), HTTP client as fallback.
  const [fetched, setFetched] = createSignal<unknown[] | undefined>(undefined);
  createEffect(
    on(
      () => JSON.stringify(location() ?? null),
      () => {
        const loc = location();
        void (async () => {
          try {
            if (ctx.data?.location?.skill?.sync)
              await ctx.data.location.skill.sync(loc);
            else if (ctx.client?.skill?.list) {
              const res = await ctx.client.skill.list({ location: loc });
              setFetched((res as any)?.data?.data ?? (res as any)?.data ?? []);
            }
          } catch {
            // never surface errors in the sidebar
          }
        })();
      },
    ),
  );
  const catalogue = createMemo(() =>
    normalizeSkills(
      safe(() => ctx.data.location.skill.list(location())) ?? fetched() ?? [],
    ),
  );
  const [enriched, setEnriched] = createSignal<{
    catalogue: ReturnType<typeof normalizeSkills>;
    skills: ReturnType<typeof normalizeSkills>;
  }>();
  createEffect(
    on(catalogue, (items) => {
      const resolve = createProvenanceResolver();
      void resolveCurrentSkills(
        items,
        resolve,
        (resolved) => catalogue() === resolved,
        (skills) => setEnriched({ catalogue: items, skills }),
      );
    }),
  );
  const skills = () => {
    const result = enriched();
    return result?.catalogue === catalogue() ? result.skills : catalogue();
  };

  const messages = createMemo(
    () => safe(() => ctx.data.session.message.list(props.sessionID)) ?? [],
  );
  const usage = createMemo(
    () => safe(() => deriveUsage(messages())) ?? new Map(),
  );

  const contextLimit = createMemo(() => {
    const models = safe(() => ctx.data.location.model.list(location()));
    const ref =
      lastAssistantModel(messages()) ?? safe(() => ctx.ui.model?.current?.());
    return contextLimitFor(ref, models);
  });

  const groups = createMemo(() =>
    buildGroups(skills(), usage(), {
      projectDir: location()?.directory ?? "",
      homeDir: homedir(),
      contextLimit: contextLimit(),
    }),
  );

  const collapsible = () => groups().total > 2;
  const visibleGroups = createMemo(() =>
    displayGroups(groups(), grouping(), { hideInactive: hideInactive() }),
  );
  const expanded = () => !collapsible() || open();

  const summary = () => {
    const g = groups();
    const parts = [
      g.loaded > 0 ? `${g.loaded} loaded` : `${g.total} available`,
    ];
    if (g.active > 0) parts.push(`${g.active} active`);
    return ` (${parts.join(", ")})`;
  };

  const openSkillActions = async (row: SkillRow) => {
    const skill = skills().find((item) => item.name === row.name);
    if (!skill) return;
    const id = skill.id || skill.name;
    const invocation = `@${id}`;
    const details = [
      skill.description || "No description available.",
      `Scope: ${row.scope}`,
      `Status: ${row.active ? "running" : row.loaded ? "loaded" : "available"}`,
      ...(skill.location ? [`Path: ${skill.location}`] : []),
    ];
    let action: string | undefined;
    let back: boolean;
    do {
      action = await ctx.ui.dialog.select({
        title: skill.name,
        options: [
          {
            title: "Use now",
            value: "use",
            description: "Send a request to this session",
          },
          {
            title: "Copy to clipboard",
            value: "copy",
            description: invocation,
          },
          { title: "View details", value: "details" },
        ],
      });
      back = false;
      if (action === "details") {
        back =
          (await ctx.ui.dialog.confirm({
            title: skill.name,
            message: details.join("\n\n"),
            label: { confirm: "Close", cancel: "Back" },
          })) === false;
      }
    } while (back);
    if (action === "copy") {
      try {
        if (!ctx.renderer.copyToClipboardOSC52(invocation))
          throw new Error("Clipboard unavailable");
        ctx.ui.toast.show({
          message: "Invocation sent to terminal clipboard",
          variant: "success",
        });
      } catch {
        ctx.ui.toast.show({
          message:
            "Could not copy. Your terminal may not support clipboard access.",
          variant: "error",
        });
      }
    } else if (action === "use") {
      try {
        if (!ctx.client?.session?.prompt)
          throw new Error("Session prompt unavailable");
        await ctx.client.session.prompt({
          sessionID: props.sessionID,
          text: invocation,
          skills: [
            {
              id,
              mention: { start: 0, end: invocation.length, text: invocation },
            },
          ],
        });
      } catch {
        ctx.ui.toast.show({
          message: `Could not send request to use ${skill.name}.`,
          variant: "error",
        });
      }
    }
  };

  const Row = (rowProps: { row: SkillRow }) => {
    const row = () => rowProps.row;
    return (
      <box
        flexDirection="row"
        gap={1}
        minWidth={0}
        onMouseUp={() => void openSkillActions(row())}
      >
        <Show
          when={row().active}
          fallback={
            <text
              flexShrink={0}
              style={{
                fg: row().loaded
                  ? theme().text.feedback.success.base
                  : theme().text.muted,
              }}
            >
              •
            </text>
          }
        >
          <box flexShrink={0}>
            <spinner
              frames={SPINNER_FRAMES}
              interval={80}
              color={theme().text.feedback.warning.base}
            />
          </box>
        </Show>
        <text
          fg={row().loaded ? theme().text.base : theme().text.muted}
          wrapMode="none"
          truncate
          flexGrow={1}
          flexShrink={1}
          minWidth={0}
        >
          {row().loaded ? <b>{row().name}</b> : row().name}
        </text>
        <Show when={row().active}>
          <text wrapMode="none" flexShrink={0} fg={theme().text.muted}>
            running
          </text>
        </Show>
      </box>
    );
  };

  const Group = (groupProps: {
    title: string;
    rows: SkillRow[];
    open: boolean;
    toggle: () => void;
  }) => (
    <Show when={groupProps.rows.length > 0}>
      <box>
        <Show when={groupProps.title}>
          <box
            flexDirection="row"
            gap={1}
            minWidth={0}
            onMouseDown={groupProps.toggle}
          >
            <text
              flexShrink={1}
              minWidth={0}
              wrapMode="none"
              truncate
              fg={theme().text.muted}
            >
              <i>{groupProps.title}</i>
            </text>
            <text flexShrink={0} fg={theme().text.muted}>
              ({groupProps.rows.length})
            </text>
            <text flexShrink={0} fg={theme().text.muted}>
              {groupProps.open ? "▾" : "▸"}
            </text>
          </box>
        </Show>
        <Show when={groupProps.open}>
          <box>
            <For each={groupProps.rows}>{(row) => <Row row={row} />}</For>
          </box>
        </Show>
      </box>
    </Show>
  );

  return (
    <Show when={groups().total > 0}>
      <box>
        <box
          flexDirection="row"
          gap={1}
          onMouseDown={() => collapsible() && toggle()}
        >
          <Show when={collapsible()}>
            <text fg={theme().text.base}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text.base}>
            <b>Skills</b>
            <Show when={!expanded()}>
              <span style={{ fg: theme().text.muted }}>{summary()}</span>
            </Show>
            <Show when={groups().loaded > 0}>
              <span style={{ fg: theme().text.muted }}>
                {" "}
                {formatTokenSummary(
                  groups().loadedTokens,
                  groups().loadedPercent,
                )}
              </span>
            </Show>
          </text>
        </box>
        <Show when={expanded()}>
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            <text flexShrink={0} fg={theme().text.muted}>
              Group By:
            </text>
            <For each={GROUPING_MODES}>
              {(mode) => (
                <text
                  flexShrink={0}
                  fg={
                    grouping() === mode.value
                      ? theme().text.base
                      : theme().text.muted
                  }
                  onMouseUp={() => selectGrouping(mode.value)}
                >
                  {grouping() === mode.value ? (
                    <b>[{mode.title}]</b>
                  ) : (
                    mode.title
                  )}
                </text>
              )}
            </For>
          </box>
          <Show
            when={grouping() === "none"}
            fallback={
              <For each={visibleGroups()}>
                {(group) => (
                  <Group
                    title={group.title}
                    rows={group.rows}
                    open={!closedGroups().has(group.key)}
                    toggle={() => toggleGroup(group.key)}
                  />
                )}
              </For>
            }
          >
            <For each={visibleGroups()[0]?.rows.filter((row) => row.loaded)}>
              {(row) => <Row row={row} />}
            </For>
            <Show when={groups().total > groups().loaded}>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => selectHideInactive(!hideInactive())}
              >
                <text fg={theme().text.muted}>
                  <i>Inactive</i>
                </text>
                <text fg={theme().text.muted}>
                  {hideInactive() ? "▸" : "▾"}
                </text>
              </box>
              <For each={visibleGroups()[0]?.rows.filter((row) => !row.loaded)}>
                {(row) => <Row row={row} />}
              </For>
            </Show>
          </Show>
        </Show>
      </box>
    </Show>
  );
}

export default {
  id: "skills-sidebar",
  setup(ctx: Host) {
    // Slot claims are appended in registration order (external plugins load after the built-ins),
    // so the section lands below MCP/Todo; OpenCode 2.x has no numeric `order` for claims.
    return ctx.ui.slot({
      append: "sidebar.content",
      render: (props: { sessionID: string }) => (
        <SkillsSection ctx={ctx} sessionID={props.sessionID} />
      ),
    });
  },
};
