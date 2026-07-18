import type { JsonSchema, Tool, ToolCall } from "../types.ts";

// 复制参数
function clone<T>(value: T): T {
  return structuredClone(value);
}

// 判断是不是普通对象
// 是 object、不是 null、不是数组 → 才算"对象"
// value is ... 是类型守卫：返回 true 后，TS 就知道它是对象，后面能安全访问字段
// 类型守卫 = 一个"带通行证检查"的函数，它的语法特征是返回值类型写成 参数名 is 类型，让 TypeScript 在 if 分支里信任这个变量属于该类型
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 拿一个 schema（规则）去检查一个 value（值）合不合规，不合规就 throw。
// path 是当前检查到的字段路径，只用于报错时定位。
function validateValue(schema: JsonSchema, value: unknown, path: string): void {
  // 没写类型直接放行
  if (!schema.type) return;

  // 假设schema期望是object
  if (schema.type === "object") {
    if (!isRecord(value))
      // 非object，直接抛出错误
      throw new Error(`${path}: expected object`);

    // 遍历 schema.required（?? [] 意思是"没写就当空数组"）。
    // 用 key in value 判断该字段在不在，缺了就报 xxx.key: required。
    for (const key of schema.required ?? []) {
      if (!(key in value)) throw new Error(`${path}.${key}: required`);
    }

    // 逐个校验已有属性：遍历 schema.properties（每个字段对应的子规则）。
    // Object.entries 把对象拆成 [键, 子schema] 对。
    // 只校验值里实际存在的字段（if (key in value)）
    // 然后递归调用 validateValue 检查子字段，path 追加成 ${path}.${key}。
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value)
        validateValue(childSchema, value[key], `${path}.${key}`);
    }

    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) throw new Error(`${path}: expected array`);
    if (schema.items) {
      value.forEach((item, index) =>
        validateValue(schema.items!, item, `${path}[${index}]`),
      );
    }
    return;
  }

  if (schema.type === "integer") {
    if (!Number.isInteger(value)) throw new Error(`${path}: expected integer`);
    return;
  }

  if (schema.type === "null") {
    if (value !== null) throw new Error(`${path}: expected null`);
    return;
  }

  if (typeof value !== schema.type) {
    throw new Error(`${path}: expected ${schema.type}`);
  }
}

// 返回值是 Record<string, unknown>
// 是一份校验通过、干净的参数对象（键是字符串、值待定）。
export function validateToolCall(
  tools: Tool[],
  toolCall: ToolCall,
): Record<string, unknown> {
  // tools 里按 name 找模型要调用的那个。
  // 没找到就抛错（模型瞎编了个不存在的工具）。
  const tool = tools.find((candidate) => candidate.name === toolCall.name);
  if (!tool) throw new Error(`Tool "${toolCall.name}" not found`);

  // clone 深拷贝一份，避免校验/后续改到原始数据。
  const args = clone(toolCall.arguments);
  // 把工具的 parameters（schema）和参数交给 validateValue 递归检查
  // 不合规就抛错。
  validateValue(tool.parameters, args, "arguments");
  return args;
}
