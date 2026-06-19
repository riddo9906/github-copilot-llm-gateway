import { OpenAIToolDefinition } from './types';

export class ToolSchemaBuilder {

  static build(
    tools: OpenAIToolDefinition[],
    options?: {
      maxTools?: number;
      maxDescriptionLength?: number;
    }
  ): OpenAIToolDefinition[] {

    const maxTools = options?.maxTools ?? 6;
    const maxDescriptionLength = options?.maxDescriptionLength ?? 120;

    return tools
      .slice(0, maxTools)
      .map((tool): OpenAIToolDefinition => {

        const fn = tool.function;

        return {
          type: "function" as const,   // ✅ FIXED LITERAL TYPE
          function: {
            name: fn.name,
            description: this.truncate(fn.description ?? '', maxDescriptionLength),
            parameters: this.simplifyParams(fn.parameters)
          }
        };
      });
  }

  private static simplifyParams(params: any) {
    if (!params) return { type: "object", properties: {} };

    return {
      type: params.type ?? "object",
      properties: params.properties ?? {},
      required: params.required ?? []
    };
  }

  private static truncate(text: string, max: number) {
    if (!text) return '';
    return text.length > max ? text.slice(0, max) + "…" : text;
  }
}