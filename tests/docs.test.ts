/**
 * The README has to keep up with the code.
 *
 * A command or a tool that is not documented is a command nobody can find, so
 * this test fails when the two drift apart.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "../src/commands/registry.js";
import { createDefaultRegistry } from "../src/tools/index.js";
import { PERMISSION_MODES } from "../src/permissions/types.js";
import { PRESETS } from "../src/providers/presets.js";
import { HOOK_EVENTS } from "../src/hooks/runner.js";

const readme = readFileSync(
  fileURLToPath(new URL("../README.md", import.meta.url)),
  "utf8",
);

/**
 * Every source file, except the one that declares the hook events.
 *
 * The declaration is not evidence that an event happens, so it is left out.
 */
const readSources = (): readonly string[] => {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const files: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) {
        continue;
      }
      if (path.endsWith("/hooks/runner.ts")) {
        continue;
      }
      files.push(readFileSync(path, "utf8"));
    }
  };

  walk(root);
  return files;
};

describe("the README", () => {
  it("documents every slash command", () => {
    for (const command of COMMANDS) {
      expect(readme).toContain(`/${command.name}`);
    }
  });

  it("documents every built-in tool", () => {
    for (const tool of createDefaultRegistry().list()) {
      expect(readme).toContain(tool.name);
    }
  });

  it("documents every permission mode", () => {
    for (const mode of PERMISSION_MODES) {
      expect(readme).toContain(mode);
    }
  });

  it("documents every provider preset", () => {
    for (const preset of PRESETS) {
      expect(readme).toContain(preset.id);
    }
  });

  it("shows the logo", () => {
    expect(readme).toContain("assets/logo.svg");
  });

  it("states that no ownership is claimed over the name", () => {
    expect(readme).toContain("No ownership");
    expect(readme).toContain("MIT");
  });

  it("points at the licence and the notice", () => {
    expect(readme).toContain("LICENSE");
    expect(readme).toContain("NOTICE");
  });

  it("documents the install command", () => {
    expect(readme).toContain("npm i -g flow-code-cli");
  });
});

describe("the hook events", () => {
  it("documents every one of them", () => {
    for (const event of HOOK_EVENTS) {
      expect(readme).toContain(`\`${event}\``);
    }
  });

  it("fires every one of them somewhere in the code", () => {
    const sources = readSources();

    for (const event of HOOK_EVENTS) {
      const fired = sources.some((source) => source.includes(`"${event}"`));
      expect(fired).toBe(true);
    }
  });
});

describe("the NOTICE", () => {
  const notice = readFileSync(
    fileURLToPath(new URL("../NOTICE", import.meta.url)),
    "utf8",
  );

  it("states the position on the name", () => {
    expect(notice).toContain("No\nownership, copyright, or trademark is claimed over the name");
    expect(notice).toContain("Anyone is free to use, copy, fork, modify, redistribute, and build");
    expect(notice).toContain("welcome to rename it");
  });
  it("lists the third-party packages", () => {
    for (const name of ["ink", "react", "zod", "diff", "@modelcontextprotocol/client"]) {
      expect(notice).toContain(name);
    }
  });

  it("records the clean-room statement", () => {
    expect(notice).toContain("no source code, system prompts, internal strings, or assets");
  });
});

describe("the licence", () => {
  const licence = readFileSync(
    fileURLToPath(new URL("../LICENSE", import.meta.url)),
    "utf8",
  );

  it("is the MIT licence", () => {
    expect(licence).toContain("MIT License");
    expect(licence).toContain("THE SOFTWARE IS PROVIDED \"AS IS\"");
  });
});
