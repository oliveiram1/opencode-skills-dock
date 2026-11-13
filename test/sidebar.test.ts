import { expect, test } from "bun:test";
import "@opentui/solid/preload";
import { testRender } from "@opentui/solid";

const { default: plugin } = await import("../tui");

test.each([false, true])(
  "clickable grouping and collapse state (storage: %s)",
  async (withStorage) => {
    let renderSidebar = () => undefined;
    let slotDisposed = false;
    const saved: Record<string, Record<string, unknown>> = {};
    let delayGroupingWrites = false;
    const pendingGroupingSaves: Array<{
      succeed: () => void;
      fail: () => void;
    }> = [];
    let notifySecondGroupingSave: (() => void) | undefined;
    const toasts: string[] = [];
    const color = "#ffffff";
    const dispose = plugin.setup({
      location: { directory: "/project" },
      theme: {
        text: {
          base: color,
          muted: color,
          feedback: { success: { base: color }, warning: { base: color } },
        },
      },
      renderer: { copyToClipboardOSC52: () => true },
      storage: withStorage
        ? {
            store: (key, { initial }) => {
              const state = (saved[key] ??= { ...initial });
              return [
                state,
                (update) => {
                  if (key === "grouping" && delayGroupingWrites) {
                    return new Promise<void>((resolve, reject) => {
                      pendingGroupingSaves.push({
                        succeed: () => {
                          update(state);
                          resolve();
                        },
                        fail: () => reject(new Error("Save failed")),
                      });
                      if (pendingGroupingSaves.length === 2)
                        notifySecondGroupingSave?.();
                    });
                  }
                  update(state);
                  return Promise.resolve();
                },
              ];
            },
          }
        : undefined,
      data: {
        location: {
          skill: {
            list: () => [
              {
                name: "local-skill",
                path: "/project/local/SKILL.md",
                author: "Alice",
              },
              {
                name: "global-skill",
                path: "/global/SKILL.md",
                author: "GoogleChrome/modern-web-guidance",
              },
              { name: "unknown-skill", path: "/global/unknown/SKILL.md" },
            ],
          },
        },
        session: {
          get: () => undefined,
          message: {
            list: () => [
              { type: "skill", skill: "local-skill", time: { created: 1 } },
            ],
          },
        },
      },
      ui: {
        slot: ({ render }) => {
          renderSidebar = () => render({ sessionID: "test" });
          return () => {
            slotDisposed = true;
          };
        },
        dialog: {
          select: async () => undefined,
          confirm: async () => undefined,
        },
        toast: {
          show: ({ message }) => {
            toasts.push(message);
          },
        },
      },
    });
    expect(slotDisposed).toBe(false);
    const ui = await testRender(() => renderSidebar(), {
      width: 32,
      height: 20,
    });
    try {
      await ui.renderOnce();
      const clickText = async (text: string) => {
        const lines = ui.captureCharFrame().split("\n");
        const y = lines.findIndex((line) => line.includes(text));
        expect(y).toBeGreaterThanOrEqual(0);
        await ui.mockMouse.click(lines[y]!.indexOf(text), y);
        await ui.renderOnce();
      };
      expect(ui.captureCharFrame()).toContain("Group By: [None] Scope Author");
      expect(ui.captureCharFrame()).toContain("Inactive ▾");
      expect(ui.captureCharFrame()).toMatch(/^• local-skill/m);
      expect(ui.captureCharFrame().indexOf("local-skill")).toBeLessThan(
        ui.captureCharFrame().indexOf("Inactive ▾"),
      );
      expect(ui.captureCharFrame().indexOf("Inactive ▾")).toBeLessThan(
        ui.captureCharFrame().indexOf("global-skill"),
      );
      if (withStorage) {
        delayGroupingWrites = true;
        await clickText("Scope");
        await clickText("Author");
        expect(ui.captureCharFrame()).toContain("[Author]");
        expect(pendingGroupingSaves).toHaveLength(1);
        const secondSaveStarted = new Promise<void>((resolve) => {
          notifySecondGroupingSave = resolve;
        });
        pendingGroupingSaves[0]!.succeed();
        await secondSaveStarted;
        await ui.renderOnce();
        expect(ui.captureCharFrame()).toContain("[Author]");
        pendingGroupingSaves[1]!.fail();
        await ui.renderOnce();
        expect(ui.captureCharFrame()).toContain("[Author]");
        expect(saved.grouping?.mode).toBe("scope");
        expect(toasts).toEqual(["Grouping changed, but could not be saved."]);
        delayGroupingWrites = false;
      }
      await clickText("Scope");
      expect(ui.captureCharFrame()).toContain("[Scope]");
      expect(ui.captureCharFrame()).not.toContain("Inactive ▾");
      expect(ui.captureCharFrame()).toContain("Local (1)");
      await clickText("Author");
      expect(ui.captureCharFrame()).toContain("Alice (1)");
      expect(ui.captureCharFrame()).toContain("Unknown source (1)");
      expect(ui.captureCharFrame()).toMatch(/^• local-skill/m);
      await clickText("Alice (1)");
      expect(ui.captureCharFrame()).not.toContain("local-skill");
      await clickText("Scope");
      expect(ui.captureCharFrame()).toContain("local-skill");
      expect(ui.captureCharFrame()).toMatch(/^• local-skill/m);
      await clickText("Author");
      expect(ui.captureCharFrame()).not.toContain("local-skill");
      ui.resize(26, 20);
      await ui.renderOnce();
      expect(ui.captureCharFrame()).toContain("[Author]");
      expect(ui.captureCharFrame()).toContain("Unknown source (1)");
      const longHeading = ui
        .captureCharFrame()
        .split("\n")
        .find((line) => line.includes("Google"));
      expect(longHeading).toContain("(1)");
      expect(longHeading).toContain("...");
      expect(longHeading).not.toContain("GoogleChrome/modern-web-guidance");
      expect(ui.captureCharFrame()).not.toMatch(/^ {2}\S/m);
      await clickText("None");
      expect(ui.captureCharFrame()).toContain("[None]");
      expect(ui.captureCharFrame()).not.toContain("Alice (1)");
      expect(ui.captureCharFrame()).not.toContain("Unknown source (1)");
      expect(ui.captureCharFrame()).toMatch(/^• local-skill/m);
      await clickText("Inactive ▾");
      expect(ui.captureCharFrame()).toContain("Inactive ▸");
      expect(ui.captureCharFrame()).toContain("local-skill");
      expect(ui.captureCharFrame()).not.toContain("global-skill");
      expect(ui.captureCharFrame()).not.toContain("unknown-skill");
      if (withStorage) expect(saved.grouping?.hideInactive).toBe(true);
    } finally {
      await ui.dispose();
      dispose();
      expect(slotDisposed).toBe(true);
    }
  },
);
