import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeParser } from "../src/parser.ts";

describe("CodeParser — React/JSX support", () => {
  let parser: CodeParser;
  let fixtureDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "graph-parser-cache-"));
    parser = new CodeParser(cacheDir);
    await parser.init();
    fixtureDir = await mkdtemp(join(tmpdir(), "graph-parser-test-"));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  });

  async function writeFixture(name: string, content: string): Promise<string> {
    const filepath = join(fixtureDir, name);
    await writeFile(filepath, content, "utf-8");
    return filepath;
  }

  test(".tsx files parse without errors", async () => {
    const filepath = await writeFixture(
      "App.tsx",
      `
      import React from "react";
      export function App() { return <div>Hello</div>; }
    `,
    );
    const { entities } = await parser.parse(filepath);
    expect(entities.find((e) => e.name === "App")).toBeDefined();
  });

  test("arrow function component detected as 'component' entity", async () => {
    const filepath = await writeFixture(
      "Button.tsx",
      `
      const Button = () => <div>Click me</div>;
      const helper = () => 42;
    `,
    );
    const { entities } = await parser.parse(filepath);

    const button = entities.find((e) => e.name === "Button");
    expect(button).toBeDefined();
    expect(button!.type).toBe("component");

    const helperEntity = entities.find((e) => e.name === "helper");
    expect(helperEntity).toBeDefined();
    expect(helperEntity!.type).toBe("variable");
  });

  test("hook (const useX = () => ...) detected as 'hook' entity", async () => {
    const filepath = await writeFixture(
      "useTheme.tsx",
      `
      const useTheme = () => { return { color: "red" }; };
      const useAuth = () => { return { user: null }; };
    `,
    );
    const { entities } = await parser.parse(filepath);

    const hook1 = entities.find((e) => e.name === "useTheme");
    expect(hook1).toBeDefined();
    expect(hook1!.type).toBe("hook");

    const hook2 = entities.find((e) => e.name === "useAuth");
    expect(hook2).toBeDefined();
    expect(hook2!.type).toBe("hook");
  });

  test("JSX component usage detected as 'calls' relationship", async () => {
    const filepath = await writeFixture(
      "App.tsx",
      `
      const Button = () => <div>Click</div>;
      const App = () => <Button />;
    `,
    );
    const { relationships } = await parser.parse(filepath);

    const calls = relationships.filter((r) => r.type === "calls");
    const jsxCall = calls.find((r) => r.from === "App" && r.to === "Button");
    expect(jsxCall).toBeDefined();
  });

  test("calls inside arrow functions have correct enclosing entity name", async () => {
    const filepath = await writeFixture(
      "Wrapper.tsx",
      `
      function doSomething() {}
      const Wrapper = () => { doSomething(); return <div />; };
    `,
    );
    const { relationships } = await parser.parse(filepath);

    const calls = relationships.filter((r) => r.type === "calls");
    const call = calls.find(
      (r) => r.from === "Wrapper" && r.to === "doSomething",
    );
    expect(call).toBeDefined();
  });

  test("nested JSX — both parent and child detected", async () => {
    const filepath = await writeFixture(
      "Layout.tsx",
      `
      const Header = () => <div>Header</div>;
      const Footer = () => <div>Footer</div>;
      const Layout = () => <div><Header /><Footer /></div>;
    `,
    );
    const { relationships } = await parser.parse(filepath);

    const calls = relationships.filter(
      (r) => r.type === "calls" && r.from === "Layout",
    );
    const callTargets = calls.map((r) => r.to);
    expect(callTargets).toContain("Header");
    expect(callTargets).toContain("Footer");
  });

  test("intrinsic HTML elements excluded from relationships", async () => {
    const filepath = await writeFixture(
      "Plain.tsx",
      `
      const Box = () => <div><span>hello</span><section>world</section></div>;
    `,
    );
    const { relationships } = await parser.parse(filepath);

    const calls = relationships.filter((r) => r.type === "calls");
    expect(calls).toHaveLength(0);
  });

  test("member expression JSX (e.g. motion.div) handled gracefully", async () => {
    const filepath = await writeFixture(
      "Animated.tsx",
      `
      const motion = { div: () => null };
      const Animated = () => <motion.div>hello</motion.div>;
    `,
    );
    // Should not throw
    const { relationships } = await parser.parse(filepath);
    // motion.div starts with lowercase, so it should be excluded
    const calls = relationships.filter(
      (r) => r.type === "calls" && r.from === "Animated",
    );
    expect(calls.every((r) => r.to !== "motion.div")).toBe(true);
  });

  test("function expression component detected as 'component'", async () => {
    const filepath = await writeFixture(
      "Card.tsx",
      `
      const Card = function() { return <div>Card</div>; };
    `,
    );
    const { entities } = await parser.parse(filepath);

    const card = entities.find((e) => e.name === "Card");
    expect(card).toBeDefined();
    expect(card!.type).toBe("component");
  });

  test("full React fixture — entities and relationships", async () => {
    const filepath = await writeFixture(
      "Screen.tsx",
      `
      import { View } from "react-native";
      const Button = () => <View />;
      const App = () => <Button />;
      const useTheme = () => { return {}; };
      export function Screen() { const t = useTheme(); return <App />; }
    `,
    );
    const { entities, relationships } = await parser.parse(filepath);

    // Entities
    expect(entities.find((e) => e.name === "Button")!.type).toBe("component");
    expect(entities.find((e) => e.name === "App")!.type).toBe("component");
    expect(entities.find((e) => e.name === "useTheme")!.type).toBe("hook");
    expect(entities.find((e) => e.name === "Screen")!.type).toBe("function");

    // Relationships — calls
    const calls = relationships.filter((r) => r.type === "calls");
    expect(
      calls.find((r) => r.from === "App" && r.to === "Button"),
    ).toBeDefined();
    expect(
      calls.find((r) => r.from === "Screen" && r.to === "useTheme"),
    ).toBeDefined();
    expect(
      calls.find((r) => r.from === "Screen" && r.to === "App"),
    ).toBeDefined();
  });

  test("existing call graph for named functions still works", async () => {
    const filepath = await writeFixture(
      "plain.ts",
      `
      function foo() { return bar(); }
      function bar() { return 42; }
    `,
    );
    const { relationships } = await parser.parse(filepath);

    const calls = relationships.filter((r) => r.type === "calls");
    expect(calls.find((r) => r.from === "foo" && r.to === "bar")).toBeDefined();
  });
});
