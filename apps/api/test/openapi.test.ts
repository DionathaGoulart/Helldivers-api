import SwaggerParser from "@apidevtools/swagger-parser";
import {
  Collection,
  collectionSchemas,
  DatasetManifest,
  entityNames,
  Item,
  List,
  Problem,
  QueryList,
  SearchResponse,
} from "@hd2/schemas";
import { describe, expect, it } from "vitest";
import { EXAMPLE_IDS } from "../scripts/site/examples.ts";
import { PROBLEM_TYPES } from "../src/lib/problem.ts";
import { syntheticSite } from "./helpers.ts";

// `/v1/openapi.json` is the public contract (plan §8 Phase 6): it must parse as OpenAPI 3.1 and
// every documented example must be a body the matching zod schema accepts.

const pascal = (name: string) =>
  name.replace(/(^|-)([a-z])/g, (_match, _dash: string, letter: string) => letter.toUpperCase());

describe("openapi", () => {
  it("validates as OpenAPI 3.1", async () => {
    const { site } = await syntheticSite();
    // validate() dereferences in place; the document is JSON, so a clone keeps the build's copy.
    // openapi-types requires `webhooks` on a 3.1 document; the specification does not.
    const document = structuredClone(site.openapi) as unknown as Parameters<
      typeof SwaggerParser.validate
    >[0];
    await expect(SwaggerParser.validate(document)).resolves.toBeDefined();
  });

  it("documents the repository, the docs site and the dataset", async () => {
    const { site } = await syntheticSite();
    const { info, externalDocs, servers } = site.openapi;
    expect(info.title).toBe("Helldivers 2 Data API");
    expect(info.version).toBe("v1");
    expect(info.license).toEqual({ name: "CC BY-NC-SA 4.0", identifier: "CC-BY-NC-SA-4.0" });
    expect(info.contact).toHaveProperty("url", "https://github.com/DionathaGoulart/Helldivers-api");
    expect(externalDocs).toHaveProperty("url", "https://helldivers-api.dionatha.com.br/");
    expect(servers[0]).toHaveProperty("url", "https://helldivers-api.dionatha.com.br");
  });

  it("marks the dynamic routes as rate limited, with an optional bearer key", async () => {
    const { site } = await syntheticSite();
    const { paths, components } = site.openapi;
    expect(components.securitySchemes).toHaveProperty(["apiKey", "scheme"], "bearer");
    for (const path of ["/v1/search", "/v1/query/weapons"]) {
      const get = paths[path]?.get as {
        security: unknown;
        responses: Record<string, { headers?: Record<string, unknown> }>;
      };
      expect(get.security).toEqual([{}, { apiKey: [] }]);
      expect(Object.keys(get.responses)).toEqual(expect.arrayContaining(["200", "401", "429"]));
      expect(Object.keys(get.responses["429"]?.headers ?? {})).toEqual([
        "X-API-Tier",
        "RateLimit-Policy",
        "RateLimit",
        "Retry-After",
      ]);
    }
    expect(paths["/v1/weapons.json"]?.get).not.toHaveProperty("security");
    expect(site.openapi.info.description).toContain(
      "- `anon`: no key, per IP, 10 requests per 60 s.",
    );
  });

  it("links the published JSON Schema of every entity", async () => {
    const { site } = await syntheticSite();
    for (const collection of Collection.options) {
      const entity = site.openapi.components.schemas[pascal(entityNames[collection])];
      expect(entity?.externalDocs).toEqual({
        description: "JSON Schema",
        url: `/v1/schemas/${entityNames[collection]}.json`,
      });
      expect(site.files.has(`v1/schemas/${entityNames[collection]}.json`)).toBe(true);
    }
  });

  it("answers every list, item, facet and query route with a real example", async () => {
    const { site } = await syntheticSite();
    const { paths, components } = site.openapi;
    type Ok = { content?: Record<string, { examples?: { default: { $ref: string } } }> };
    const exampleOf = (path: string) => {
      const responses = paths[path]?.get.responses as Record<string, Ok> | undefined;
      const content = responses?.["200"]?.content ?? {};
      const ref = Object.values(content)[0]?.examples?.default.$ref ?? "";
      return components.examples[ref.replace("#/components/examples/", "")];
    };

    for (const collection of Collection.options) {
      const entity = pascal(entityNames[collection]);
      const schema = collectionSchemas[collection];
      const item = exampleOf(`/v1/${collection}/{id}.json`);
      const list = exampleOf(`/v1/${collection}.json`);
      const query = exampleOf(`/v1/query/${collection}`);
      expect(Item(schema).parse(item?.value)).toBeDefined();
      expect(List(schema).parse(list?.value)).toBeDefined();
      expect(QueryList(schema).parse(query?.value)).toBeDefined();
      expect(components.examples).toHaveProperty(`${entity}Item`);
      // Facets answer the list envelope and reuse its example.
      const facet = Object.keys(paths).find((path) => path.startsWith(`/v1/${collection}/by-`));
      if (facet) expect(exampleOf(facet)).toBe(list);
    }
  });

  it("takes the examples from the dataset", async () => {
    const { site } = await syntheticSite();
    const example = site.openapi.components.examples.WeaponItem?.value as { data: { id: string } };
    expect(example.data.id).toBe(EXAMPLE_IDS.weapons);
    expect(site.openapi.components.examples.WeaponItem?.summary).toBe("AR-23 Liberator");
  });

  it("shows the manifest, a search response and a problem body", async () => {
    const { site } = await syntheticSite();
    const { examples } = site.openapi.components;
    expect(DatasetManifest.parse(examples.DatasetManifest?.value)).toBeDefined();
    expect(SearchResponse.parse(examples.SearchResponse?.value)).toBeDefined();
    const problem = Problem.parse(examples.Problem?.value);
    expect(problem.type).toContain("/docs/errors#invalid-filter-value");
    expect(problem.status).toBe(PROBLEM_TYPES["invalid-filter-value"].status);
  });
});
