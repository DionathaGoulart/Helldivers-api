import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { textOf } from "./html.ts";

export interface Section {
  id: string; // "Page_3"
  title: string; // "Page 3"
  level: number;
  content: Cheerio<Element>; // top-level nodes up to the next heading of the same or higher level
}

interface Heading {
  id: string;
  title: string;
  level: number;
}

// Both markups occur (arch §4.2): `h3 > span.mw-headline#Id` and `div.mw-heading > h3#Id`.
function headingOf($: CheerioAPI, element: Element): Heading | null {
  const node = $(element);
  const heading = node.is("h1, h2, h3, h4, h5, h6")
    ? node
    : node.is(".mw-heading")
      ? node.children("h1, h2, h3, h4, h5, h6").first()
      : null;
  const tag = heading?.get(0)?.tagName;
  if (!heading || !tag) {
    return null;
  }
  return {
    id: heading.find(".mw-headline").attr("id") ?? heading.attr("id") ?? "",
    title: textOf(heading),
    level: Number(tag.slice(1)),
  };
}

/** Every heading of `level` in the article body with its content. */
export function readSections($: CheerioAPI, level: number): Section[] {
  const sections: Section[] = [];
  let current: { heading: Heading; nodes: Element[] } | null = null;
  const close = () => {
    if (current) {
      sections.push({ ...current.heading, content: $(current.nodes) });
    }
  };

  for (const element of $("#mw-content-text > .mw-parser-output").first().children().toArray()) {
    const heading = headingOf($, element);
    if (heading && heading.level <= level) {
      close();
      current = heading.level === level ? { heading, nodes: [] } : null;
    } else {
      current?.nodes.push(element);
    }
  }
  close();
  return sections;
}

/** Matches of `selector` among a section's nodes and their descendants. */
export function findInSection(section: Section, selector: string): Cheerio<Element> {
  return section.content.filter(selector).add(section.content.find(selector));
}
