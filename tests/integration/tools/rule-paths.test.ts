/**
 * Permission rules against a workspace whose path contains a symlink.
 */
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decidePermission } from "../../../src/permissions/engine.js";
import { realpathBestEffort } from "../../../src/util/paths.js";

describe("rules and a workspace behind a symlink", () => {
  let real: string;
  let link: string;

  beforeEach(async () => {
    real = await mkdtemp(join(tmpdir(), "flowcode-real-"));
    link = join(tmpdir(), `flowcode-link-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

    try {
      await symlink(real, link, "dir");
    } catch {
      // Creating a symlink needs a privilege Windows does not grant by
      // default. The check itself is covered elsewhere.
      real = "";
    }
  });

  afterEach(async () => {
    if (real !== "") {
      await rm(real, { recursive: true, force: true });
    }
    await rm(link, { recursive: true, force: true }).catch(() => undefined);
  });

  it("matches a root-anchored rule against a resolved path", async () => {
    if (real === "") {
      return;
    }

    // The engine compares a root-relative specifier with a resolved path, so
    // the root it is given has to be resolved too.
    const resolvedRoot = (await realpathBestEffort(link)) ?? link;

    const decision = decidePermission({
      tool: "read_file",
      category: "read",
      subject: `${resolvedRoot}/secrets/keys.txt`,
      subjectKind: "path",
      mode: "ask",
      rules: { allow: [], ask: [], deny: ["read_file:/secrets/**"] },
      context: { workspaceRoot: resolvedRoot, cwd: resolvedRoot, home: "/home/user" },
      withinWorkspace: true,
    });

    expect(decision.kind).toBe("deny");
  });

  it("matches a floating rule against a resolved path", async () => {
    if (real === "") {
      return;
    }

    const resolvedRoot = (await realpathBestEffort(link)) ?? link;

    const decision = decidePermission({
      tool: "read_file",
      category: "read",
      subject: `${resolvedRoot}/config/.env`,
      subjectKind: "path",
      mode: "ask",
      rules: { allow: [], ask: [], deny: ["read_file:**/.env"] },
      context: { workspaceRoot: resolvedRoot, cwd: resolvedRoot, home: "/home/user" },
      withinWorkspace: true,
    });

    expect(decision.kind).toBe("deny");
  });

  it("does not match a rule for a different path", async () => {
    if (real === "") {
      return;
    }

    const resolvedRoot = (await realpathBestEffort(link)) ?? link;

    const decision = decidePermission({
      tool: "read_file",
      category: "read",
      subject: `${resolvedRoot}/src/index.ts`,
      subjectKind: "path",
      mode: "ask",
      rules: { allow: [], ask: [], deny: ["read_file:/secrets/**"] },
      context: { workspaceRoot: resolvedRoot, cwd: resolvedRoot, home: "/home/user" },
      withinWorkspace: true,
    });

    expect(decision.kind).toBe("allow");
  });
});
