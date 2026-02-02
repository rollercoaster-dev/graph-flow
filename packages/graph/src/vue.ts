import { parse as sfcParse } from "@vue/compiler-sfc";

// Vue compiler-core enum values (avoids direct dependency on @vue/compiler-core)
const NODE_ELEMENT = 1;   // NodeTypes.ELEMENT
const NODE_IF = 9;        // NodeTypes.IF
const NODE_FOR = 11;      // NodeTypes.FOR
const ELEMENT_COMPONENT = 1; // ElementTypes.COMPONENT
const ELEMENT_ELEMENT = 0;   // ElementTypes.ELEMENT

export interface VueScriptBlock {
  content: string;
  lang: string;
  startLine: number;
  setup: boolean;
}

export interface VueTemplateComponents {
  names: string[];
}

/**
 * Extract script blocks from a Vue SFC.
 */
export function extractVueScripts(sfcContent: string): VueScriptBlock[] {
  const { descriptor } = sfcParse(sfcContent);
  const blocks: VueScriptBlock[] = [];

  if (descriptor.script) {
    blocks.push({
      content: descriptor.script.content,
      lang: descriptor.script.lang || "js",
      startLine: descriptor.script.loc.start.line,
      setup: false,
    });
  }

  if (descriptor.scriptSetup) {
    blocks.push({
      content: descriptor.scriptSetup.content,
      lang: descriptor.scriptSetup.lang || "js",
      startLine: descriptor.scriptSetup.loc.start.line,
      setup: true,
    });
  }

  return blocks;
}

/**
 * HTML intrinsic elements — excludes these from component detection.
 */
const HTML_ELEMENTS = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base",
  "bdi", "bdo", "blockquote", "body", "br", "button", "canvas", "caption",
  "cite", "code", "col", "colgroup", "data", "datalist", "dd", "del",
  "details", "dfn", "dialog", "div", "dl", "dt", "em", "embed", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "head", "header", "hgroup", "hr", "html", "i", "iframe", "img",
  "input", "ins", "kbd", "label", "legend", "li", "link", "main", "map",
  "mark", "menu", "meta", "meter", "nav", "noscript", "object", "ol",
  "optgroup", "option", "output", "p", "picture", "pre", "progress", "q",
  "rp", "rt", "ruby", "s", "samp", "script", "search", "section", "select",
  "slot", "small", "source", "span", "strong", "style", "sub", "summary",
  "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th",
  "thead", "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
]);

const SVG_ELEMENTS = new Set([
  "svg", "animate", "animateMotion", "animateTransform", "circle",
  "clipPath", "defs", "desc", "ellipse", "feBlend", "feColorMatrix",
  "feComponentTransfer", "feComposite", "feConvolveMatrix",
  "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow",
  "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR",
  "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology",
  "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile",
  "feTurbulence", "filter", "foreignObject", "g", "image", "line",
  "linearGradient", "marker", "mask", "metadata", "mpath", "path",
  "pattern", "polygon", "polyline", "radialGradient", "rect", "set",
  "stop", "switch", "symbol", "text", "textPath", "tspan", "use", "view",
]);

function isIntrinsicElement(tag: string): boolean {
  const lower = tag.toLowerCase();
  return HTML_ELEMENTS.has(lower) || SVG_ELEMENTS.has(lower);
}

/**
 * Convert a kebab-case tag name to PascalCase.
 */
function toPascalCase(tag: string): string {
  return tag
    .split("-")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Walk the template AST and collect custom component tag names.
 */
function walkTemplate(nodes: any[], components: Set<string>): void {
  for (const node of nodes) {
    if (node.type === NODE_ELEMENT) {
      if (
        node.tagType === ELEMENT_COMPONENT ||
        (!isIntrinsicElement(node.tag) && node.tagType === ELEMENT_ELEMENT)
      ) {
        components.add(toPascalCase(node.tag));
      }
      if (node.children) {
        walkTemplate(node.children, components);
      }
    }
    if (node.type === NODE_IF && node.branches) {
      for (const branch of node.branches) {
        walkTemplate(branch.children, components);
      }
    }
    if (node.type === NODE_FOR && node.children) {
      walkTemplate(node.children, components);
    }
  }
}

/**
 * Extract component names used in the template of a Vue SFC.
 */
export function extractTemplateComponents(sfcContent: string): VueTemplateComponents {
  const { descriptor } = sfcParse(sfcContent);
  const components = new Set<string>();

  if (descriptor.template?.ast) {
    walkTemplate(descriptor.template.ast.children, components);
  }

  return { names: [...components] };
}
