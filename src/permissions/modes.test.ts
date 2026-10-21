import { describe, expect, it } from "vitest";
import { categoryOutcome, describeMode, isHardCeiling, isReadOnlyCommand } from "./modes.js";

describe("categoryOutcome", () => {
  it("allows reads and session control in ask mode", () => {
    expect(categoryOutcome("ask", "read")).toBe("allow");
    expect(categoryOutcome("ask", "control")).toBe("allow");
  });

  it("asks for everything else in ask mode", () => {
    expect(categoryOutcome("ask", "write")).toBe("ask");
    expect(categoryOutcome("ask", "execute")).toBe("ask");
    expect(categoryOutcome("ask", "network")).toBe("ask");
  });

  it("allows writes in accept_edits mode", () => {
    expect(categoryOutcome("accept_edits", "write")).toBe("allow");
    expect(categoryOutcome("accept_edits", "execute")).toBe("ask");
  });

  it("denies changes in plan and safe modes", () => {
    for (const mode of ["plan", "safe"] as const) {
      expect(categoryOutcome(mode, "write")).toBe("deny");
      expect(categoryOutcome(mode, "execute")).toBe("deny");
      expect(categoryOutcome(mode, "network")).toBe("deny");
      expect(categoryOutcome(mode, "read")).toBe("allow");
    }
  });

  it("allows everything in trust mode", () => {
    for (const category of ["read", "write", "execute", "network", "control"] as const) {
      expect(categoryOutcome("trust", category)).toBe("allow");
    }
  });
});

describe("isHardCeiling", () => {
  it("reports a ceiling only for the modes that have one", () => {
    expect(isHardCeiling("plan", "write")).toBe(true);
    expect(isHardCeiling("safe", "network")).toBe(true);
    expect(isHardCeiling("ask", "write")).toBe(false);
    expect(isHardCeiling("accept_edits", "write")).toBe(false);
    expect(isHardCeiling("trust", "write")).toBe(false);
  });
});

describe("describeMode", () => {
  it("describes every mode", () => {
    for (const mode of ["ask", "accept_edits", "plan", "safe", "trust"] as const) {
      expect(describeMode(mode).length).toBeGreaterThan(0);
    }
  });
});

describe("isReadOnlyCommand", () => {
  it("recognises commands that only read", () => {
    expect(isReadOnlyCommand("ls", "linux")).toBe(true);
    expect(isReadOnlyCommand("ls -la", "linux")).toBe(true);
    expect(isReadOnlyCommand("cat package.json", "linux")).toBe(true);
    expect(isReadOnlyCommand("grep -r foo src", "linux")).toBe(true);
    expect(isReadOnlyCommand("pwd", "linux")).toBe(true);
  });

  it("recognises read-only git subcommands", () => {
    expect(isReadOnlyCommand("git status", "linux")).toBe(true);
    expect(isReadOnlyCommand("git log --oneline", "linux")).toBe(true);
    expect(isReadOnlyCommand("git diff", "linux")).toBe(true);
  });

  it("rejects git commands that write", () => {
    expect(isReadOnlyCommand("git commit -m x", "linux")).toBe(false);
    expect(isReadOnlyCommand("git push", "linux")).toBe(false);
  });

  it("rejects commands that write", () => {
    expect(isReadOnlyCommand("rm -rf build", "linux")).toBe(false);
    expect(isReadOnlyCommand("npm install", "linux")).toBe(false);
    expect(isReadOnlyCommand("mkdir out", "linux")).toBe(false);
  });

  it("rejects a find that acts", () => {
    expect(isReadOnlyCommand("find . -name '*.ts'", "linux")).toBe(true);
    expect(isReadOnlyCommand("find . -delete", "linux")).toBe(false);
    expect(isReadOnlyCommand("find . -exec rm {} ;", "linux")).toBe(false);
  });

  it("rejects a redirect", () => {
    expect(isReadOnlyCommand("ls > out.txt", "linux")).toBe(false);
    expect(isReadOnlyCommand("ls 2>&1", "linux")).toBe(false);
  });

  it("rejects running a program, even an interpreter", () => {
    expect(isReadOnlyCommand("node script.js", "linux")).toBe(false);
    expect(isReadOnlyCommand("python script.py", "linux")).toBe(false);
  });

  it("ignores a leading environment assignment", () => {
    expect(isReadOnlyCommand("NODE_ENV=test ls", "linux")).toBe(true);
    expect(isReadOnlyCommand("NODE_ENV=test rm -rf x", "linux")).toBe(false);
  });

  it("rejects an environment assignment that chooses the program", () => {
    expect(isReadOnlyCommand("PATH=/tmp/evil ls", "linux")).toBe(false);
    expect(isReadOnlyCommand("LD_PRELOAD=/tmp/evil.so ls", "linux")).toBe(false);
  });

  it("treats a chain as read-only only when every part is", () => {
    expect(isReadOnlyCommand("ls && cat file", "linux")).toBe(true);
    expect(isReadOnlyCommand("ls && rm file", "linux")).toBe(false);
  });

  it("rejects an empty command", () => {
    expect(isReadOnlyCommand("", "linux")).toBe(false);
  });
});

/**
 * The commands that must never be auto-approved.
 *
 * Every one of them has been seen to do something other than what its first
 * word suggests.
 */
const DANGEROUS_COMMANDS: readonly string[] = [
  "echo $(touch x)",
  "echo `touch x`",
  "ls\ntouch x",
  "env sh -c 'touch x'",
  "env touch x",
  "cat .env",
  "printenv",
  "find . -fprint x",
  "git config core.sshCommand y",
  "git stash",
  "git branch -D main",
  "git tag -d v1",
  "git remote add e https://e/x.git",
  "git diff --output=x",
  "cat <(touch x)",
];

describe("a command that must never be auto-approved", () => {
  it.each(DANGEROUS_COMMANDS)("refuses '%s'", (command) => {
    expect(isReadOnlyCommand(command, "linux")).toBe(false);
    expect(isReadOnlyCommand(command, "win32")).toBe(false);
  });

  it("still allows a plain listing and a plain status", () => {
    expect(isReadOnlyCommand("ls -la", "linux")).toBe(true);
    expect(isReadOnlyCommand("git status", "linux")).toBe(true);
    expect(isReadOnlyCommand("ls -la", "win32")).toBe(true);
    expect(isReadOnlyCommand("git status", "win32")).toBe(true);
  });
});

describe("a command that hides what it does", () => {
  it("is not read-only when it substitutes a command", () => {
    expect(isReadOnlyCommand("echo $(touch x)", "linux")).toBe(false);
    expect(isReadOnlyCommand("echo `touch x`", "linux")).toBe(false);
    expect(isReadOnlyCommand("cat <(touch x)", "linux")).toBe(false);
  });

  it("is not read-only when it carries a second command", () => {
    expect(isReadOnlyCommand("ls\ntouch x", "linux")).toBe(false);
  });

  it("is not read-only when it runs through another program", () => {
    expect(isReadOnlyCommand("env sh -c 'touch x'", "linux")).toBe(false);
    expect(isReadOnlyCommand("env touch x", "linux")).toBe(false);
  });

  it("is not read-only when it prints the environment", () => {
    expect(isReadOnlyCommand("printenv", "linux")).toBe(false);
    expect(isReadOnlyCommand("env", "linux")).toBe(false);
  });

  it("is not read-only when it uses a backslash", () => {
    expect(isReadOnlyCommand("ls \\; touch x", "linux")).toBe(false);
  });
});

describe("a command that reads a secret", () => {
  it("is not read-only when it reads an environment file", () => {
    expect(isReadOnlyCommand("cat .env", "linux")).toBe(false);
    expect(isReadOnlyCommand("cat .env.local", "linux")).toBe(false);
    expect(isReadOnlyCommand("grep -r KEY .env", "linux")).toBe(false);
    expect(isReadOnlyCommand("head -n 5 .env", "linux")).toBe(false);
    expect(isReadOnlyCommand("find . -name .env", "linux")).toBe(false);
  });

  it("is not read-only when it reads a key", () => {
    expect(isReadOnlyCommand("cat id_rsa", "linux")).toBe(false);
    expect(isReadOnlyCommand("cat server.pem", "linux")).toBe(false);
    expect(isReadOnlyCommand("cat .npmrc", "linux")).toBe(false);
  });

  it("is not read-only when it reads a secret from the history", () => {
    expect(isReadOnlyCommand("git show HEAD:.env", "linux")).toBe(false);
  });

  it("is not read-only when a wildcard could reach a secret", () => {
    expect(isReadOnlyCommand("cat .e*", "linux")).toBe(false);
    expect(isReadOnlyCommand("cat .env*", "linux")).toBe(false);
    expect(isReadOnlyCommand("cat $HOME/.e*", "linux")).toBe(false);
    expect(isReadOnlyCommand("cat /etc/shadow", "linux")).toBe(false);
  });

  it("is not read-only when a pattern it cannot reason about could reach one", () => {
    // A bracket and a brace are expanded by the shell, and this matcher
    // does not know what they expand to.
    expect(isReadOnlyCommand("cat .[a-z]*", "linux")).toBe(false);
    expect(isReadOnlyCommand("cat .e[nv]*", "linux")).toBe(false);
    expect(isReadOnlyCommand("cat {,.}env", "linux")).toBe(false);
    expect(isReadOnlyCommand("ls .[a-z]*", "linux")).toBe(false);
  });

  it("does not mind a wildcard that cannot reach one", () => {
    expect(isReadOnlyCommand("cat *.ts", "linux")).toBe(true);
    expect(isReadOnlyCommand("cat src/*.ts", "linux")).toBe(true);
  });

  it("does not mind an ordinary file", () => {
    expect(isReadOnlyCommand("cat package.json", "linux")).toBe(true);
    expect(isReadOnlyCommand("cat src/environment.ts", "linux")).toBe(true);
  });

  it("takes a quoted argument as one argument", () => {
    expect(isReadOnlyCommand("grep -r 'a b' src", "linux")).toBe(true);
    expect(isReadOnlyCommand("cat 'my file.txt'", "linux")).toBe(true);
  });
});

describe("a find that writes", () => {
  it("is not read-only when it prints to a file", () => {
    expect(isReadOnlyCommand("find . -fprint x", "linux")).toBe(false);
    expect(isReadOnlyCommand("find . -fprintf x y", "linux")).toBe(false);
    expect(isReadOnlyCommand("find . -fls x", "linux")).toBe(false);
  });

  it("is not read-only when it runs another command", () => {
    expect(isReadOnlyCommand("find . -ok ls", "linux")).toBe(false);
    expect(isReadOnlyCommand("find . -okdir ls", "linux")).toBe(false);
    expect(isReadOnlyCommand("find . -exec ls", "linux")).toBe(false);
    expect(isReadOnlyCommand("find . -delete", "linux")).toBe(false);
    expect(isReadOnlyCommand("fd --exec ls", "linux")).toBe(false);
  });
});

describe("a git command that writes", () => {
  it("is not read-only when it changes the configuration", () => {
    expect(isReadOnlyCommand("git config core.sshCommand y", "linux")).toBe(false);
    expect(isReadOnlyCommand("git -c core.sshCommand=y status", "linux")).toBe(false);
  });

  it("is not read-only when it stashes, branches, tags or remotes", () => {
    expect(isReadOnlyCommand("git stash", "linux")).toBe(false);
    expect(isReadOnlyCommand("git branch -D main", "linux")).toBe(false);
    expect(isReadOnlyCommand("git tag -d v1", "linux")).toBe(false);
    expect(isReadOnlyCommand("git remote add e https://e/x.git", "linux")).toBe(false);
  });

  it("is not read-only when it writes a file", () => {
    expect(isReadOnlyCommand("git diff --output=x", "linux")).toBe(false);
    expect(isReadOnlyCommand("git diff --output x", "linux")).toBe(false);
  });
});

describe("a command that is only allowed to read", () => {
  it("is not read-only when it can run another program", () => {
    expect(isReadOnlyCommand("fd -x rm", "linux")).toBe(false);
    expect(isReadOnlyCommand("fd -X curl https://example.test", "linux")).toBe(false);
    expect(isReadOnlyCommand("rg --pre 'sh -c id' .", "linux")).toBe(false);
  });

  it("is not read-only when it can write a file", () => {
    expect(isReadOnlyCommand("find . -fprint0 out", "linux")).toBe(false);
    expect(isReadOnlyCommand("tree -o out.txt", "linux")).toBe(false);
  });

  it("is not read-only when the program is only named like one", () => {
    expect(isReadOnlyCommand("/tmp/evil/ls", "linux")).toBe(false);
    expect(isReadOnlyCommand("./ls", "linux")).toBe(false);
  });
});

describe("the read-only gate on Windows", () => {
  it("allows the handful of commands that mean the same thing everywhere", () => {
    expect(isReadOnlyCommand("ls -la", "win32")).toBe(true);
    expect(isReadOnlyCommand("git status", "win32")).toBe(true);
    expect(isReadOnlyCommand("pwd", "win32")).toBe(true);
  });

  it("allows nothing else", () => {
    expect(isReadOnlyCommand("cat package.json", "win32")).toBe(false);
    expect(isReadOnlyCommand("grep -r foo src", "win32")).toBe(false);
    expect(isReadOnlyCommand("find . -name x", "win32")).toBe(false);
    expect(isReadOnlyCommand("Get-Content file", "win32")).toBe(false);
  });
});