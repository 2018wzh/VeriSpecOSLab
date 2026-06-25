import type { OutputSchemaDefinition, JsonSchema } from "../agent/output-schemas.ts";
import type { Tool } from "./types.ts";

export const STRUCTURED_OUTPUT_TOOL_NAME = "StructuredOutput";

export function createStructuredOutputTool(options: {
  schema: OutputSchemaDefinition;
  onStructuredOutput: (value: unknown) => void;
}): Tool {
  return {
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    schema: {
      type: "function",
      function: {
        name: STRUCTURED_OUTPUT_TOOL_NAME,
        description: `Return the final schema-valid ${options.schema.id} structured output for this VOS task.`,
        parameters: options.schema.schema as unknown as Record<string, unknown>,
      },
    },
    execute(argumentsJson: string): string {
      let value: unknown;
      try {
        value = JSON.parse(argumentsJson);
      } catch (error) {
        return `Error validating StructuredOutput: arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
      }
      const errors = validateSchema(value, options.schema.schema, "StructuredOutput");
      if (errors.length > 0) {
        return `Error validating StructuredOutput for ${options.schema.id}:\n${errors.join("\n")}`;
      }
      options.onStructuredOutput(value);
      return `StructuredOutput accepted for ${options.schema.id}. End your turn with a short confirmation.`;
    },
  };
}

function validateSchema(value: unknown, schema: JsonSchema, path: string): string[] {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [`${path} must be object`];
    }
    const record = value as Record<string, unknown>;
    const errors: string[] = [];
    const properties = "properties" in schema ? schema.properties : {};
    for (const key of "required" in schema ? schema.required ?? [] : []) {
      if (!(key in record)) {
        errors.push(`${path}.${key} is required`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (record[key] === undefined) continue;
      errors.push(...validateSchema(record[key], childSchema, `${path}.${key}`));
    }
    return errors;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path} must be array`];
    return value.flatMap((entry, index) => validateSchema(entry, schema.items, `${path}[${index}]`));
  }
  if (schema.type === "string") {
    if (typeof value !== "string") return [`${path} must be string`];
    if (schema.enum && !schema.enum.includes(value)) {
      return [`${path} must be one of ${schema.enum.join(", ")}`];
    }
    return [];
  }
  if (schema.type === "boolean") return typeof value === "boolean" ? [] : [`${path} must be boolean`];
  if (schema.type === "number") return typeof value === "number" ? [] : [`${path} must be number`];
  if (schema.type === "integer") return Number.isInteger(value) ? [] : [`${path} must be integer`];
  return [];
}
