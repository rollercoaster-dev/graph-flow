import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeParser } from "../src/parser.ts";
import { extractTemplateComponents, extractVueScripts } from "../src/vue.ts";

const CACHE_DIR = "/tmp/graph-flow-test-vue-cache";

// ── Fixtures ──────────────────────────────────────────────

const SCRIPT_TS = `<template>
  <div>{{ message }}</div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

interface Props {
  msg: string;
}

export function greet(name: string): string {
  return "Hello " + name;
}

export default defineComponent({
  name: "ScriptTs",
});
</script>
`;

const SCRIPT_SETUP = `<template>
  <div>{{ count }}</div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const count = ref(0);

function increment() {
  count.value++;
}
</script>
`;

const TEMPLATE_COMPONENTS = `<template>
  <div>
    <MyHeader title="Hello" />
    <sidebar-nav :items="items" />
    <main>
      <article-card v-for="a in articles" :key="a.id" />
    </main>
    <AppFooter />
  </div>
</template>

<script setup lang="ts">
import MyHeader from "./MyHeader.vue";
import SidebarNav from "./SidebarNav.vue";
import ArticleCard from "./ArticleCard.vue";
import AppFooter from "./AppFooter.vue";
</script>
`;

const EMPTY_SCRIPT = `<template>
  <div>Static content</div>
</template>
`;

const BOTH_SCRIPTS = `<script lang="ts">
export interface Config {
  debug: boolean;
}
</script>

<script setup lang="ts">
import { ref } from "vue";

const enabled = ref(true);
</script>

<template>
  <div>{{ enabled }}</div>
</template>
`;

// ── extractVueScripts ─────────────────────────────────────

describe("extractVueScripts", () => {
  test("extracts <script lang='ts'> block", () => {
    const blocks = extractVueScripts(SCRIPT_TS);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].setup).toBe(false);
    expect(blocks[0].lang).toBe("ts");
    expect(blocks[0].content).toContain("defineComponent");
    expect(blocks[0].startLine).toBeGreaterThan(1);
  });

  test("extracts <script setup lang='ts'> block", () => {
    const blocks = extractVueScripts(SCRIPT_SETUP);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].setup).toBe(true);
    expect(blocks[0].lang).toBe("ts");
    expect(blocks[0].content).toContain("ref(0)");
  });

  test("returns empty array for file with no script", () => {
    const blocks = extractVueScripts(EMPTY_SCRIPT);
    expect(blocks).toHaveLength(0);
  });

  test("extracts both <script> and <script setup>", () => {
    const blocks = extractVueScripts(BOTH_SCRIPTS);
    expect(blocks).toHaveLength(2);

    const regular = blocks.find((b) => !b.setup);
    const setup = blocks.find((b) => b.setup);
    expect(regular).toBeDefined();
    expect(setup).toBeDefined();
    if (!regular || !setup) {
      throw new Error("Expected both regular and setup script blocks");
    }

    expect(regular.content).toContain("Config");
    expect(setup.content).toContain("ref(true)");
    expect(setup.startLine).toBeGreaterThan(regular.startLine);
  });
});

// ── extractTemplateComponents ─────────────────────────────

describe("extractTemplateComponents", () => {
  test("extracts PascalCase and kebab-case component names", () => {
    const { names } = extractTemplateComponents(TEMPLATE_COMPONENTS);
    expect(names).toContain("MyHeader");
    expect(names).toContain("SidebarNav");
    expect(names).toContain("ArticleCard");
    expect(names).toContain("AppFooter");
  });

  test("does not include HTML intrinsic elements", () => {
    const { names } = extractTemplateComponents(TEMPLATE_COMPONENTS);
    expect(names).not.toContain("Div");
    expect(names).not.toContain("Main");
    expect(names).not.toContain("div");
    expect(names).not.toContain("main");
  });

  test("returns empty names for file with no template", () => {
    const { names } = extractTemplateComponents(`<script setup lang="ts">
const x = 1;
</script>`);
    expect(names).toHaveLength(0);
  });

  test("returns empty names for template with only HTML elements", () => {
    const { names } = extractTemplateComponents(`<template>
  <div><span>hello</span></div>
</template>`);
    expect(names).toHaveLength(0);
  });
});

// ── CodeParser integration ────────────────────────────────

describe("CodeParser with .vue files", () => {
  let parser: CodeParser;
  let fixtureDir: string;

  beforeEach(async () => {
    parser = new CodeParser(CACHE_DIR);
    await parser.init();
    fixtureDir = await mkdtemp(join(tmpdir(), "graph-vue-test-"));
  });

  afterEach(async () => {
    await rm(CACHE_DIR, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  });

  async function writeFixture(name: string, content: string): Promise<string> {
    const filepath = join(fixtureDir, name);
    await writeFile(filepath, content, "utf-8");
    return filepath;
  }

  test("parses .vue file with <script lang='ts'> — extracts functions and interfaces", async () => {
    const filepath = await writeFixture("ScriptTs.vue", SCRIPT_TS);
    const { entities } = await parser.parse(filepath);

    const fn = entities.find((e) => e.name === "greet");
    expect(fn).toBeDefined();
    expect(fn?.type).toBe("function");

    const iface = entities.find((e) => e.name === "Props");
    expect(iface).toBeDefined();
    expect(iface?.type).toBe("interface");
  });

  test("parses .vue file with <script setup> — extracts variables and adds component entity", async () => {
    const filepath = await writeFixture("Counter.vue", SCRIPT_SETUP);
    const { entities } = await parser.parse(filepath);

    const comp = entities.find((e) => e.type === "component");
    expect(comp).toBeDefined();
    expect(comp?.name).toBe("Counter");

    const countVar = entities.find((e) => e.name === "count");
    expect(countVar).toBeDefined();
    expect(countVar?.type).toBe("variable");
  });

  test("line numbers are offset to match positions in the .vue file", async () => {
    const filepath = await writeFixture("Offset.vue", SCRIPT_TS);
    const { entities } = await parser.parse(filepath);

    // In SCRIPT_TS: <script> is line 5, greet function is on line 12
    const fn = entities.find((e) => e.name === "greet");
    expect(fn).toBeDefined();
    if (!fn) {
      throw new Error("Expected greet function to be parsed");
    }
    expect(fn.location.line).toBe(12);

    // Props interface is on line 8
    const iface = entities.find((e) => e.name === "Props");
    expect(iface).toBeDefined();
    if (!iface) {
      throw new Error("Expected Props interface to be parsed");
    }
    expect(iface.location.line).toBe(8);
  });

  test("template component usage creates 'uses' relationships", async () => {
    const filepath = await writeFixture(
      "WithComponents.vue",
      TEMPLATE_COMPONENTS,
    );
    const { relationships } = await parser.parse(filepath);

    const uses = relationships.filter((r) => r.type === "uses");
    const usedNames = uses.map((r) => r.to);
    expect(usedNames).toContain("MyHeader");
    expect(usedNames).toContain("SidebarNav");
    expect(usedNames).toContain("ArticleCard");
    expect(usedNames).toContain("AppFooter");
  });

  test("empty/missing script block returns no entities from script", async () => {
    const filepath = await writeFixture("Empty.vue", EMPTY_SCRIPT);
    const { entities, relationships } = await parser.parse(filepath);
    expect(entities).toHaveLength(0);
    expect(relationships).toHaveLength(0);
  });

  test("file with both <script> and <script setup> — both are parsed", async () => {
    const filepath = await writeFixture("Both.vue", BOTH_SCRIPTS);
    const { entities } = await parser.parse(filepath);

    const iface = entities.find((e) => e.name === "Config");
    expect(iface).toBeDefined();
    expect(iface?.type).toBe("interface");

    const variable = entities.find((e) => e.name === "enabled");
    expect(variable).toBeDefined();

    const comp = entities.find((e) => e.type === "component");
    expect(comp).toBeDefined();
    expect(comp?.name).toBe("Both");
  });

  test("cache round-trip works for .vue files", async () => {
    const filepath = await writeFixture("Cached.vue", SCRIPT_SETUP);

    // First parse — populates cache
    const result1 = await parser.parse(filepath);

    // Second parse — should come from cache
    const result2 = await parser.parse(filepath);

    expect(result2.entities).toEqual(result1.entities);
    expect(result2.relationships).toEqual(result1.relationships);
  });

  test("imports in .vue script blocks create 'imports' relationships", async () => {
    const filepath = await writeFixture("WithImports.vue", SCRIPT_SETUP);
    const { relationships } = await parser.parse(filepath);

    const imports = relationships.filter((r) => r.type === "imports");
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.some((r) => r.to.includes("ref"))).toBe(true);
  });

  test("non-.vue files are completely unaffected", async () => {
    const tsContent = `export function hello(): string { return "hi"; }`;
    const filepath = await writeFixture("plain.ts", tsContent);
    const { entities } = await parser.parse(filepath);

    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("hello");
    expect(entities[0].type).toBe("function");
  });
});
