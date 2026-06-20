import { OpenAIToolDefinition } from './types';

export interface ToolRouterContext {
  model: string;
  messages: any[];
}

export class ToolRouter {

  static select(
    tools: OpenAIToolDefinition[],
    context: ToolRouterContext
  ): OpenAIToolDefinition[] {

    const prompt = String(
      this.getLastUserMessage(context) ?? ""
    ).toLowerCase().trim();

    const model = String(context.model ?? "").toLowerCase();

    console.log("====================================");
    console.log("[ToolRouter] SELECT CALLED");
    console.log("[ToolRouter] Model:", model);
    console.log("[ToolRouter] Prompt:", JSON.stringify(prompt));
    console.log("[ToolRouter] Input tools:", tools.length);

    const isSmallModel =
      model.includes("1b") ||
      model.includes("2b") ||
      model.includes("3b") ||
      model.includes("tiny");

    const allowed = new Set<string>();

    // ---------------- FILE OPS ----------------

    if (
      prompt.includes("file") ||
      prompt.includes("edit") ||
      prompt.includes("modify")
    ) {
      allowed.add("read_file");
      allowed.add("write_file");
      allowed.add("apply_patch");
    }

    // ---------------- DEBUG ----------------

    if (
      prompt.includes("error") ||
      prompt.includes("bug") ||
      prompt.includes("fix")
    ) {
      allowed.add("read_file");
      allowed.add("search_code");
    }

    // ---------------- TERMINAL ----------------

    if (
      prompt.includes("run") ||
      prompt.includes("execute") ||
      prompt.includes("install")
    ) {
      allowed.add("run_terminal");
    }

    // ---------------- SEARCH ----------------

    if (
      prompt.includes("search") ||
      prompt.includes("find") ||
      prompt.includes("lookup")
    ) {
      allowed.add("web_search");
      allowed.add("search_code");
    }

    console.log("[ToolRouter] Allowed tool names:", [...allowed]);

    if (allowed.size === 0) {
      console.log("[ToolRouter] No matching tools. Returning []");
      console.log("====================================");
      return [];
    }

    const maxTools = isSmallModel ? 3 : 6;

    const selected = tools
      .filter(tool => {
        const name = tool.function?.name;
        return typeof name === "string" && allowed.has(name);
      })
      .slice(0, maxTools);

    console.log(
      "[ToolRouter] Selected:",
      selected.map(t => t.function.name)
    );

    console.log("====================================");

    return selected;
  }

  static getLastUserMessage(context: ToolRouterContext): string {

    const messages = Array.isArray(context.messages)
      ? context.messages
      : [];

    console.log("[ToolRouter] Messages:", messages.length);

    for (let i = messages.length - 1; i >= 0; i--) {

      const message = messages[i];

      console.log(
        `[ToolRouter] Inspecting message ${i}: role=${message?.role}`
      );

      if (message?.role !== "user") {
        continue;
      }

      const content = message.content;

      // Standard OpenAI format
      if (typeof content === "string") {
        console.log("[ToolRouter] Found string content:", content);
        return content;
      }

      // OpenAI content array
      if (Array.isArray(content)) {

        const text = content
          .filter(
            (part: any) =>
              part &&
              part.type === "text" &&
              typeof part.text === "string"
          )
          .map((part: any) => part.text)
          .join(" ");

        console.log("[ToolRouter] Found array content:", text);

        return text;
      }

      // Single content object
      if (
        content &&
        typeof content === "object" &&
        typeof (content as any).text === "string"
      ) {
        console.log("[ToolRouter] Found object content:", (content as any).text);
        return (content as any).text;
      }

      console.log("[ToolRouter] Unknown content format:", content);
      return "";
    }

    console.log("[ToolRouter] No user message found.");
    return "";
  }
}