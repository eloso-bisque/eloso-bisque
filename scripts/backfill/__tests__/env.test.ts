import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnvFile, loadEnvFile } from "../env";

describe("parseEnvFile", () => {
  it("parses key=value pairs, ignoring blank lines and comments", () => {
    const content = ["# a comment", "", "FOO=bar", "BAZ=qux"].join("\n");
    expect(parseEnvFile(content)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("strips matching single or double quotes around the value", () => {
    const content = ['A="double quoted"', "B='single quoted'", "C=unquoted"].join("\n");
    expect(parseEnvFile(content)).toEqual({ A: "double quoted", B: "single quoted", C: "unquoted" });
  });

  it("preserves '=' characters inside the value", () => {
    const content = "URL=postgres://user:pass@host/db?a=1&b=2";
    expect(parseEnvFile(content)).toEqual({ URL: "postgres://user:pass@host/db?a=1&b=2" });
  });

  it("ignores lines with no '=' separator", () => {
    expect(parseEnvFile("not-a-valid-line\nFOO=bar")).toEqual({ FOO: "bar" });
  });
});

describe("loadEnvFile", () => {
  const savedEnv = { ...process.env };
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "backfill-env-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it("loads the first existing file from the candidate list", () => {
    const filePath = join(dir, ".env.test");
    writeFileSync(filePath, "BACKFILL_TEST_VAR=hello\n");
    const loaded = loadEnvFile([join(dir, ".env.missing"), filePath]);
    expect(loaded).toBe(filePath);
    expect(process.env.BACKFILL_TEST_VAR).toBe("hello");
  });

  it("does not overwrite a variable already set in process.env", () => {
    process.env.BACKFILL_TEST_VAR = "already-set";
    const filePath = join(dir, ".env.test2");
    writeFileSync(filePath, "BACKFILL_TEST_VAR=from-file\n");
    loadEnvFile([filePath]);
    expect(process.env.BACKFILL_TEST_VAR).toBe("already-set");
  });

  it("returns null when no candidate file exists", () => {
    const loaded = loadEnvFile([join(dir, ".env.nope")]);
    expect(loaded).toBeNull();
  });
});
