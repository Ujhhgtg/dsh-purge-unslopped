// 注入正文永远是第一个 section；postPrompt 是唯一可选的附加段。
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerPromptSections } from "../lib/index.js";
import { GLOBAL_PROMPT_ORDER } from "../lib/identity.js";

function harness(overrides = {}) {
  const sections = [];
  const ctx = {
    systemPrompt: {
      section(spec) {
        sections.push(spec);
        return () => {};
      },
    },
    logger: { warn() {} },
  };
  const config = {
    enabled: true,
    postPrompt: "",
    postPromptOrder: 5100,
    ...overrides,
  };
  return { ctx, config, sections };
}

test("registers one inject section at the head", () => {
  const h = harness();
  registerPromptSections(h.ctx, h.config);
  assert.equal(h.sections.length, 1);
  const [section] = h.sections;
  assert.equal(section.name, "dsh-purge");
  assert.equal(section.order, GLOBAL_PROMPT_ORDER);
  assert.equal(section.interpolate, false);
  assert.equal(typeof section.text, "function");
  assert.equal(section.text({}).length > 1000, true, "bundled prompt is injected");
});

test("disabled plugin yields an empty section", () => {
  const h = harness({ enabled: false });
  registerPromptSections(h.ctx, h.config);
  assert.equal(h.sections[0].text({}), "");
});

test("postPrompt is opt-in and validated", () => {
  const off = harness({ postPrompt: "   " });
  registerPromptSections(off.ctx, off.config);
  assert.equal(off.sections.length, 1);

  const on = harness({ postPrompt: "EXTRA", postPromptOrder: 5100 });
  registerPromptSections(on.ctx, on.config);
  assert.equal(on.sections.length, 2);
  const post = on.sections.find((s) => s.name === "dsh-purge:post");
  assert.ok(post);
  assert.equal(post.order, 5100);
  assert.equal(post.text({}), "EXTRA");

  const bad = harness({ postPrompt: "EXTRA", postPromptOrder: GLOBAL_PROMPT_ORDER });
  registerPromptSections(bad.ctx, bad.config);
  assert.equal(bad.sections.some((s) => s.name === "dsh-purge:post"), false);
});
