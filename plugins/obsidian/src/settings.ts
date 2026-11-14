import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { AI_PROVIDERS } from "@dg/contract/llm.ts";
import { removeWalkthroughExamples } from "@dg/native/walkthrough.ts";
import { openDialog, zoteroState } from "./actions.ts";
import type DiscourseGraphsPlugin from "./main.ts";
import { walkthrough, walkthroughBase } from "./walkthrough.ts";

/**
 * Everything a person can choose, in one place, grouped by what it affects.
 * The page is drawn at once and filled in when the core answers, so opening
 * Settings never waits. Choices are per device and kept by the core, so every
 * panel sees the same ones. A model key goes to the keychain, never to `data.json`.
 */
export class DiscourseGraphsSettings extends PluginSettingTab {
  constructor(app: App, private readonly plugin: DiscourseGraphsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("dg-settings");
    const { plugin } = this;
    const heading = (title: string, about?: string): void => {
      const made = new Setting(containerEl).setName(title).setHeading();
      if (about) made.setDesc(about);
    };

    // ---------------------------------------------------------------- You
    heading("You");
    const name = new Setting(containerEl).setName("Your name").setDesc("Shown on the units, relations and canvases you make.");
    const lab = new Setting(containerEl).setName("Lab").setDesc("Checking…");
    lab.addButton((button) => button.setButtonText("Join or start a lab").onClick(() => void openDialog(plugin, "welcome")));

    // ---------------------------------------------------------------- Types
    heading("Types and relations", "Your lab's own kinds of unit, what may join them, and what a new note of each kind starts with.");
    new Setting(containerEl)
      .setName("Types, relations and templates")
      .setDesc("Add or change a type, give it a template, say which types a relation may join, or share the whole set as a schema file.")
      .addButton((button) => button.setButtonText("Open").onClick(() => void openDialog(plugin, "grammar")));

    // ---------------------------------------------------------------- AI
    heading("Ask AI", "Whose model answers questions about a canvas. With none set up, a question quotes the closest units word for word.");
    const source = new Setting(containerEl).setName("Model").setDesc("Checking…");
    const provider = new Setting(containerEl).setName("Provider");
    const address = new Setting(containerEl).setName("Address").setDesc("For OpenAI, OpenRouter, or a model server on this computer such as Ollama (http://localhost:11434/v1).");
    const key = new Setting(containerEl).setName("API key");
    const model = new Setting(containerEl).setName("Model name");
    const route = new Setting(containerEl).setName("Send questions").setDesc("Straight from this device to the provider, or through your lab's server, which uses the key for that one question and doesn't keep it.");
    const test = new Setting(containerEl).setName("Check the setup").setDesc("Sends one short test message with the saved key.");

    // ---------------------------------------------------------------- Notes
    heading("In your notes");
    const capture = new Setting(containerEl)
      .setName("Key that makes a unit from selected text")
      .setDesc("With text selected in a note, this key opens the list of unit types. Leave it empty to turn the key off; “Create unit from selection” stays in the command palette and can take any hotkey.");
    const badges = new Setting(containerEl).setName("Type badges on links").setDesc("Shows a unit's type beside each link to it in your notes.");
    new Setting(containerEl)
      .setName("Hotkeys")
      .setDesc("Every Discourse Graphs action is a command, so each can have a key of your choosing.")
      .addButton((button) =>
        button.setButtonText("Open hotkeys").onClick(() => {
          const setting = (this.app as unknown as { setting?: { openTabById: (id: string) => { searchComponent?: { setValue: (value: string) => void }; updateHotkeyVisibility?: () => void } | undefined } }).setting;
          const tab = setting?.openTabById("hotkeys");
          tab?.searchComponent?.setValue("Discourse Graphs");
          tab?.updateHotkeyVisibility?.();
        }),
      );

    // ---------------------------------------------------------------- Canvas
    heading("Canvas");
    const links = new Setting(containerEl)
      .setName("When you delete a link between cards")
      .setDesc("A link can come off this canvas only, or its relation can be withdrawn from the graph. Only the person who asserted a relation can withdraw it. Undo brings either back.");

    // ---------------------------------------------------------------- Reading and notebooks
    heading("Papers and notebooks");
    new Setting(containerEl)
      .setName("PDFs")
      .setDesc("Obsidian's own viewer stays the default. “Read this PDF” on a file, or “Read a PDF…”, opens it beside the canvas, where a highlight becomes a unit. A PDF you drop into the reader is kept in the “Paper files” folder.");
    const zotero = new Setting(containerEl)
      .setName("Use Zotero as your PDF library")
      .setDesc("Checking…");
    const notebookText = new Setting(containerEl)
      .setName("Keep printed text from notebooks")
      .setDesc("Reading a Jupyter notebook always keeps its figures and tables as outputs. Turn this on to keep printed text and plain results too.");

    // ---------------------------------------------------------------- Help
    heading("Help and privacy");
    new Setting(containerEl)
      .setName("Walkthrough")
      .setDesc("A short tour on your own graph. Its example units can be removed afterwards.")
      .addButton((button) => button.setButtonText("Start").onClick(() => void walkthrough(plugin)))
      .addButton((button) => button.setButtonText("Remove examples").onClick(() => void walkthroughBase(plugin).then(removeWalkthroughExamples)));
    const usage = new Setting(containerEl).setName("Usage log").setDesc("Checking…");
    new Setting(containerEl)
      .setName("What leaves this device")
      .setDesc(
        "Nothing, until you choose it. A lab you join receives the canvases you share with it. A model provider you set up above receives your question and the units on the canvas you ask about. Papers you upload go to the server you pick in the upload dialog.",
      );

    void plugin.ensureCore().then(async (core) => {
      const prefs = await core.prefs();

      name.addText((text) => {
        text.setValue(core.personName() ?? "").setPlaceholder("Your name");
        text.inputEl.addEventListener("change", () => {
          const next = text.getValue().trim();
          if (next) void core.setName(next);
        });
      });
      const link = await plugin.wiring.labLink();
      lab.setDesc(link?.token ? `You're in ${link.name}. Shared canvases sync with ${link.server}.` : link?.pending ? `Waiting for ${link.name} to accept your request.` : "You're not in a lab. Everything stays on this device.");

      // --- AI: redrawn from the saved setup after each change, so the rows always show what is stored.
      const drawAi = async (): Promise<void> => {
        const ai = await core.ai.settings();
        const spec = AI_PROVIDERS.find((item) => item.kind === ai.provider)!;
        const own = ai.source === "own";
        for (const row of [source, provider, address, key, model, route, test]) row.controlEl.empty();
        const kept = { keychain: "Obsidian's keychain (Settings → Keychain), encrypted by the operating system", file: "a file on this computer", plain: "this vault's plugin data on this device, unencrypted, because this version of Obsidian has no keychain", nowhere: "nowhere" }[ai.keptIn];

        source.setDesc(ai.inLab ? "Your lab has a model. You can use it, or your own." : "You're not in a lab, so answers come from your own key.");
        source.addDropdown((dropdown) => {
          if (ai.inLab) dropdown.addOption("lab", "My lab's model");
          dropdown
            .addOption("own", "My own key")
            .setValue(ai.inLab ? ai.source : "own")
            .onChange((value) => void core.ai.configure({ source: value as "lab" | "own" }).then(drawAi));
        });
        for (const row of [provider, address, key, model, route, test]) row.settingEl.toggle(own || !ai.inLab);
        address.settingEl.toggle((own || !ai.inLab) && spec.customUrl);
        route.settingEl.toggle(own && ai.inLab);

        provider.addDropdown((dropdown) => {
          for (const item of AI_PROVIDERS) dropdown.addOption(item.kind, item.label);
          dropdown.setValue(ai.provider).onChange((value) => void core.ai.configure({ provider: value as typeof ai.provider }).then(drawAi));
        });
        address.addText((text) => {
          text.setPlaceholder(spec.baseUrl).setValue(ai.baseUrl ?? "");
          text.inputEl.addEventListener("change", () => void core.ai.configure({ baseUrl: text.getValue() }).then(drawAi, (error: Error) => new Notice(error.message)));
        });

        key.setDesc(`${spec.keyHelp} ${ai.hasKey ? `A key ending ${ai.keyHint ?? "…"} is saved in ${kept}.` : `It will be kept in ${kept}.`} It is never written to your notes.`);
        key.addText((text) => {
          text.inputEl.type = "password";
          text.inputEl.autocomplete = "off";
          text.setPlaceholder(ai.hasKey ? "Paste a new key to replace it" : "Paste your key");
          text.inputEl.addEventListener("change", () => {
            const value = text.getValue().trim();
            if (value) void core.ai.configure({ key: value, source: "own" }).then(drawAi);
          });
        });
        if (ai.hasKey) key.addButton((button) => button.setButtonText("Remove").setWarning().onClick(() => void core.ai.configure({ key: null }).then(drawAi)));

        model.setDesc("Chosen from the list your key can use. If the list can't be read, type the model's id.");
        let listed: { id: string; label?: string }[] = [];
        try {
          listed = ai.hasKey || !spec.needsKey ? await core.ai.models({}) : [];
        } catch {
          listed = [];
        }
        if (listed.length) {
          model.addDropdown((dropdown) => {
            if (!listed.some((item) => item.id === ai.model) && ai.model) dropdown.addOption(ai.model, ai.model);
            for (const item of listed) dropdown.addOption(item.id, item.label ? `${item.label} (${item.id})` : item.id);
            dropdown.setValue(ai.model).onChange((value) => void core.ai.configure({ model: value }));
          });
        } else {
          model.addText((text) => {
            text.setPlaceholder(spec.defaultModel || "A model id").setValue(ai.model);
            text.inputEl.addEventListener("change", () => void core.ai.configure({ model: text.getValue().trim() }));
          });
        }

        route.addDropdown((dropdown) =>
          dropdown
            .addOption("device", "Straight from this device")
            .addOption("lab", "Through my lab's server")
            .setValue(ai.route)
            .onChange((value) => void core.ai.configure({ route: value as "device" | "lab" }).then(drawAi)),
        );
        test.addButton((button) =>
          button.setButtonText("Test").onClick(async () => {
            button.setDisabled(true).setButtonText("Testing…");
            const result = await core.ai.test();
            test.setDesc(result.ok ? `It works. ${result.message}` : result.message);
            button.setDisabled(false).setButtonText("Test");
          }),
        );
      };
      await drawAi();

      capture.addText((text) => {
        text.setValue(prefs.captureKey).setPlaceholder("Off");
        text.inputEl.maxLength = 1;
        text.inputEl.style.width = "4em";
        text.inputEl.addEventListener("change", () => {
          const next = text.getValue().trim().slice(0, 1);
          plugin.captureKey = next;
          void core.setPrefs({ captureKey: next });
        });
      });
      badges.addToggle((toggle) => toggle.setValue(core.badgesOn()).onChange((on) => void (on !== core.badgesOn() ? core.toggleBadges() : null)));
      links.addDropdown((dropdown) =>
        dropdown
          .addOption("ask", "Ask each time")
          .addOption("canvas", "Take it off this canvas only")
          .addOption("withdraw", "Withdraw the relation, if it's mine")
          .setValue(prefs.linkDelete)
          .onChange((value) => void core.setPrefs({ linkDelete: value as "ask" | "canvas" | "withdraw" })),
      );
      notebookText.addToggle((toggle) => toggle.setValue(prefs.notebookText).onChange((on) => void core.setPrefs({ notebookText: on })));

      // Zotero as the PDF library: one switch, and a line that says whether Zotero can be reached right now.
      const ZOTERO_ABOUT = "The papers to read come from Zotero and are opened where Zotero keeps them, with nothing copied into this vault. A paper Zotero holds is listed once, as Zotero's. Nothing is written to Zotero.";
      const drawZotero = async (): Promise<void> => {
        const state = await zoteroState(plugin).catch(() => null);
        zotero.setDesc(`${ZOTERO_ABOUT} ${!state ? "" : state.ok ? `Zotero ${state.version ?? ""} is answering${state.on ? `, with ${state.files} ${state.files === 1 ? "PDF" : "PDFs"}` : ""}.` : (state.problem ?? "Zotero isn't answering.")}`.trim());
      };
      zotero.addToggle((toggle) =>
        toggle.setValue(prefs.zoteroLibrary).onChange((on) => void core.setPrefs({ zoteroLibrary: on }).then(drawZotero)),
      );
      void drawZotero();

      const drawUsage = (): void => {
        const count = core.usageCount();
        usage.setDesc(`A list of which actions you used, kept on this device to show what gets used. It holds no titles or text, and nothing sends it anywhere. ${count} ${count === 1 ? "entry" : "entries"} now.`);
      };
      drawUsage();
      usage.addButton((button) => button.setButtonText("Clear").onClick(() => void core.clearUsage().then(drawUsage)));
    });
  }
}
