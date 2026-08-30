import { describe, expect, test } from "bun:test";
import { DatabaseException, DuplicateException } from "@nuvix/db";
import { QueryExecutionError } from "@nuvix/pg";
import type {
  SchemaCatalog,
  SchemaCreateInput,
  SchemaRecord,
  SchemaType,
} from "../src/database/catalog";
import type {
  DocumentSchemaBootstrap,
  DocumentSchemaInput,
} from "../src/database/document-schema";
import { createSchemaService } from "../src/database/service";

const MANAGED_SCHEMA: SchemaRecord = {
  name: "appdata",
  description: "Application data",
  type: "managed",
};

interface HarnessOptions {
  readonly schemas?: readonly SchemaRecord[];
  readonly bootstrapFailure?: unknown;
  readonly cleanupFailure?: unknown;
}

function harness(options: HarnessOptions = {}) {
  const schemas = new Map<string, SchemaRecord>(
    (options.schemas ?? []).map((schema) => [schema.name, schema] as const),
  );
  const calls = {
    lists: [] as Array<SchemaType | undefined>,
    gets: [] as string[],
    creates: [] as SchemaCreateInput[],
    updates: [] as Array<{ name: string; description: string | null }>,
    removals: [] as string[],
    bootstraps: [] as DocumentSchemaInput[],
  };
  const catalog: SchemaCatalog = {
    list: async (type) => {
      calls.lists.push(type);
      return [...schemas.values()].filter(
        (schema) => type === undefined || schema.type === type,
      );
    },
    get: async (name) => {
      calls.gets.push(name);
      return schemas.get(name);
    },
    create: async (input) => {
      calls.creates.push(input);
      schemas.set(input.name, { ...input });
    },
    update: async (name, description) => {
      calls.updates.push({ name, description });
      const current = schemas.get(name);
      if (!current) return undefined;
      const updated = { ...current, description };
      schemas.set(name, updated);
      return updated;
    },
    remove: async (name) => {
      calls.removals.push(name);
      schemas.delete(name);
      if (options.cleanupFailure) throw options.cleanupFailure;
    },
  };
  const bootstrap: DocumentSchemaBootstrap = {
    initialize: async (input) => {
      calls.bootstraps.push(input);
      if (options.bootstrapFailure) throw options.bootstrapFailure;
    },
  };

  return {
    calls,
    schemas,
    service: createSchemaService({ catalog, bootstrap }),
  };
}

function problem(error: unknown) {
  return error as {
    readonly name: string;
    readonly message: string;
    readonly status: number;
    readonly fields: {
      readonly type: string;
      readonly code?: string;
      readonly detail?: string;
      readonly messageKey?: string;
    };
  };
}

describe("schema service", () => {
  test("lists schemas with the exact v2 envelope and forwards the type filter", async () => {
    const state = harness({
      schemas: [
        MANAGED_SCHEMA,
        { name: "documents", description: null, type: "document" },
      ],
    });

    const result = await state.service.list("managed");

    expect(result).toEqual({ data: [MANAGED_SCHEMA], meta: { total: 1 } });
    expect(state.calls.lists).toEqual(["managed"]);
    expect(Object.keys(result)).toEqual(["data", "meta"]);
    expect(Object.keys(result.meta)).toEqual(["total"]);
  });

  test("gets an existing schema", async () => {
    const state = harness({ schemas: [MANAGED_SCHEMA] });

    expect(await state.service.get("appdata")).toEqual(MANAGED_SCHEMA);
  });

  test("creates a document schema with a null description and bootstraps metadata", async () => {
    const state = harness();

    const created = await state.service.create({
      name: "documents",
      type: "document",
    });

    expect(created).toEqual({
      name: "documents",
      description: null,
      type: "document",
    });
    expect(state.calls.creates).toEqual([
      { name: "documents", description: null, type: "document" },
    ]);
    expect(state.calls.bootstraps).toEqual([
      { name: "documents", type: "document" },
    ]);
  });

  test.each(["managed", "unmanaged"] as const)(
    "creates a %s schema without document metadata bootstrap",
    async (type) => {
      const state = harness();

      expect(
        await state.service.create({ name: type, description: "Data", type }),
      ).toEqual({
        name: type,
        description: "Data",
        type,
      });
      expect(state.calls.bootstraps).toEqual([]);
    },
  );

  test("updates a schema description to null", async () => {
    const state = harness({ schemas: [MANAGED_SCHEMA] });

    const updated = await state.service.update("appdata", null);

    expect(updated).toEqual({ ...MANAGED_SCHEMA, description: null });
    expect(state.calls.updates).toEqual([
      { name: "appdata", description: null },
    ]);
  });

  test("deletes an existing schema", async () => {
    const state = harness({ schemas: [MANAGED_SCHEMA] });

    await state.service.remove("appdata");

    expect(state.schemas.has("appdata")).toBe(false);
    expect(state.calls.removals).toEqual(["appdata"]);
  });

  test("prechecks duplicate names before the catalog upsert", async () => {
    const state = harness({ schemas: [MANAGED_SCHEMA] });

    const failure = await state.service
      .create({ name: "appdata", type: "document" })
      .catch((error: unknown) => error);

    expect({
      status: problem(failure).status,
      fields: problem(failure).fields,
    }).toEqual({
      status: 409,
      fields: {
        type: "/errors/conflict",
        detail: "Schema already exists",
        code: "schema_already_exists",
        messageKey: "errors.database.schemaExists",
      },
    });
    expect(state.calls.creates).toEqual([]);
    expect(state.calls.bootstraps).toEqual([]);
  });

  test.each([
    [
      "get",
      (state: ReturnType<typeof harness>) => state.service.get("missing"),
    ],
    [
      "update",
      (state: ReturnType<typeof harness>) =>
        state.service.update("missing", "Missing"),
    ],
    [
      "delete",
      (state: ReturnType<typeof harness>) => state.service.remove("missing"),
    ],
  ] as const)(
    "returns schema_not_found when %s targets a missing name",
    async (_name, run) => {
      const state = harness();

      const failure = await run(state).catch((error: unknown) => error);

      expect({
        status: problem(failure).status,
        fields: problem(failure).fields,
      }).toEqual({
        status: 404,
        fields: {
          type: "/errors/not-found",
          detail: "Schema not found",
          code: "schema_not_found",
          messageKey: "errors.database.schemaNotFound",
        },
      });
    },
  );

  test("cleans up a document schema when metadata bootstrap fails", async () => {
    const bootstrapFailure = new DatabaseException(
      "secret @nuvix/db bootstrap failure",
    );
    const state = harness({ bootstrapFailure });

    const failure = await state.service
      .create({ name: "documents", type: "document" })
      .catch((error: unknown) => error);

    expect(state.calls.removals).toEqual(["documents"]);
    expect(state.schemas.has("documents")).toBe(false);
    expect({
      status: problem(failure).status,
      fields: problem(failure).fields,
    }).toEqual({
      status: 500,
      fields: {
        type: "/errors/internal",
        detail: "Unable to initialize document schema",
      },
    });
    expect(JSON.stringify(problem(failure))).not.toContain("secret");
    expect(JSON.stringify(problem(failure))).not.toContain("DatabaseException");
  });

  test("keeps the bootstrap failure primary when cleanup also fails", async () => {
    const bootstrapFailure = new DuplicateException(
      "secret primary bootstrap failure",
    );
    const cleanupFailure = new QueryExecutionError(
      'drop schema "documents" cascade -- secret cleanup SQL',
      1,
      new Error("postgres://secret:credential@database"),
    );
    const state = harness({ bootstrapFailure, cleanupFailure });

    const failure = await state.service
      .create({ name: "documents", type: "document" })
      .catch((error: unknown) => error);

    expect(state.calls.removals).toEqual(["documents"]);
    expect(problem(failure).fields.detail).toBe(
      "Unable to initialize document schema",
    );
    const exposed = JSON.stringify(problem(failure));
    expect(exposed).not.toContain("secret");
    expect(exposed).not.toContain("drop schema");
    expect(exposed).not.toContain("QueryExecutionError");
    expect(exposed).not.toContain("DatabaseException");
  });

  test("fails closed when the PostgreSQL catalog exposes an unexpected package failure", async () => {
    const failure = new QueryExecutionError(
      "select * from credentials where password = $1",
      1,
      new Error("postgres://admin:secret@database"),
    );
    const catalog: SchemaCatalog = {
      list: async () => {
        throw failure;
      },
      get: async () => undefined,
      create: async () => undefined,
      update: async () => undefined,
      remove: async () => undefined,
    };
    const service = createSchemaService({
      catalog,
      bootstrap: { initialize: async () => undefined },
    });

    const exposedFailure = await service
      .list()
      .catch((error: unknown) => error);

    expect({
      status: problem(exposedFailure).status,
      fields: problem(exposedFailure).fields,
    }).toEqual({
      status: 500,
      fields: { type: "/errors/internal", detail: "Internal server error" },
    });
    const exposed = JSON.stringify(problem(exposedFailure));
    expect(exposed).not.toContain("credentials");
    expect(exposed).not.toContain("password");
    expect(exposed).not.toContain("secret");
    expect(exposed).not.toContain("QueryExecutionError");
  });

  test("exposes only the frozen schema operations", () => {
    const state = harness();

    expect(Object.keys(state.service)).toEqual([
      "list",
      "get",
      "create",
      "update",
      "remove",
    ]);
    expect(Object.isFrozen(state.service)).toBe(true);
    expect(state.service).not.toHaveProperty("catalog");
    expect(state.service).not.toHaveProperty("bootstrap");
  });
});
