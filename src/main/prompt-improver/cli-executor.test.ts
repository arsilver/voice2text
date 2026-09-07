import assert from "node:assert/strict";
import test from "node:test";

import { buildCliInvocation, formatCliError, GROK_MAX_TURNS } from "./cli-invocation";
import { GROK_REWRITE_ONLY_TRAILER } from "./system-prompts";

const FAKE_CWD = "C:\\tmp\\craftvoice";

test("grok args use raised max-turns and pure-rewrite flags", () => {
  const inv = buildCliInvocation("add a reset api key button", "grok", "coding", FAKE_CWD);

  assert.equal(inv.command, "grok");
  assert.equal(inv.promptViaFile, true);
  assert.ok(inv.args.includes("--max-turns"));
  assert.equal(inv.args[inv.args.indexOf("--max-turns") + 1], GROK_MAX_TURNS);
  assert.notEqual(GROK_MAX_TURNS, "1");
  assert.ok(inv.args.includes("--no-subagents"));
  assert.ok(inv.args.includes("--disable-web-search"));
  assert.ok(inv.args.includes("--permission-mode"));
  assert.equal(inv.args[inv.args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.ok(inv.args.includes("--output-format"));
  assert.equal(inv.args[inv.args.indexOf("--output-format") + 1], "plain");
  assert.ok(inv.args.includes("--cwd"));
  assert.equal(inv.args[inv.args.indexOf("--cwd") + 1], FAKE_CWD);
  assert.ok(inv.args.includes("--prompt-file"));
  assert.ok(inv.stdinText.includes("add a reset api key button"));
  assert.ok(inv.stdinText.toLowerCase().includes("only the improved prompt"));
});

test("grok system prompt includes rewrite-only trailer via system-prompt-override", () => {
  const inv = buildCliInvocation("hello world", "grok", "general", FAKE_CWD);
  const spIndex = inv.args.indexOf("--system-prompt-override");
  assert.ok(spIndex >= 0);
  const systemPrompt = inv.args[spIndex + 1];
  assert.ok(systemPrompt.includes("CRITICAL RUNTIME RULES"));
  assert.ok(systemPrompt.includes("Do NOT implement"));
  for (const line of GROK_REWRITE_ONLY_TRAILER.split("\n").filter(Boolean)) {
    assert.ok(systemPrompt.includes(line), `missing trailer line: ${line}`);
  }
});

test("claude headless args use bare print mode with tools disabled", () => {
  const inv = buildCliInvocation("fix the null check", "claude", "debugging", FAKE_CWD);
  assert.equal(inv.command, "claude");
  assert.ok(inv.args.includes("-p"));
  assert.ok(inv.args.includes("--bare"));
  assert.ok(inv.args.includes("--tools"));
  assert.equal(inv.args[inv.args.indexOf("--tools") + 1], "");
  assert.ok(inv.args.includes("--no-session-persistence"));
  assert.equal(inv.promptViaFile, false);
  assert.equal(inv.stdinText, "fix the null check");
});

test("codex embeds system prompt in stdin", () => {
  const inv = buildCliInvocation("plan the rollout", "codex", "planning", FAKE_CWD);
  assert.equal(inv.command, "codex");
  assert.ok(inv.args.includes("exec"));
  assert.ok(inv.stdinText.includes("plan the rollout"));
  assert.ok(inv.stdinText.includes("---"));
});

test("formatCliError maps max-turns failures to a clear message", () => {
  const msg = formatCliError("grok", "Max turns reached\nError: max turns reached");
  assert.match(msg, /turn limit/i);
  assert.ok(!msg.toLowerCase().includes("failed: max turns"));
});
