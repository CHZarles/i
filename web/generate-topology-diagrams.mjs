#!/usr/bin/env node
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(webDir, '..', 'articles', 'assets');

// The layout follows one runtime turn. Package ownership is metadata on each
// node, not a visual layer: Pi's package boundaries do not form a call stack.
const nodes = [
  {
    id: 'agent', x: 35, y: 112, w: 190, h: 94,
    owner: 'pi-agent', title: 'Agent', lines: ['state + subscribers', 'accepts injected', 'StreamFn'],
  },
  {
    id: 'harness', x: 35, y: 235, w: 190, h: 110,
    owner: 'pi-agent', title: 'AgentHarness',
    lines: ['owns Models / Tools', 'resources / request hooks', 'builds turn state + StreamFn'],
  },
  {
    id: 'loop', x: 305, y: 166, w: 215, h: 94,
    owner: 'pi-agent', title: 'runAgentLoop()', lines: ['orchestrates turns', 'consumes uniform events'],
  },
  {
    id: 'stream', x: 585, y: 166, w: 160, h: 94,
    owner: 'pi-agent contract', title: 'StreamFn', lines: ['model I/O port', 'returns EventStream'], contract: true,
  },
  {
    id: 'models', x: 805, y: 166, w: 160, h: 94,
    owner: 'pi-ai', title: 'Models', lines: ['find Provider', 'resolve request auth'],
  },
  {
    id: 'provider', x: 1025, y: 166, w: 150, h: 94,
    owner: 'pi-ai', title: 'Provider', lines: ['model catalog', 'dispatch model.api'],
  },
  {
    id: 'session', x: 35, y: 420, w: 190, h: 82,
    owner: 'pi-agent', title: 'Session', lines: ['build context', 'persist message_end'], sidecar: true,
  },
  {
    id: 'tools', x: 285, y: 420, w: 235, h: 98,
    owner: 'pi-agent', title: 'Tool protocol + executor', lines: ['ToolCall -> validate -> execute', 'ToolResult -> next model turn'],
  },
  {
    id: 'events', x: 565, y: 420, w: 190, h: 114,
    owner: 'pi-ai contract', title: 'AssistantMessageEventStream',
    titleLines: ['AssistantMessage', 'EventStream'],
    lines: ['start / delta / done / error', 'uniform provider-neutral', 'output'], contract: true,
  },
  {
    id: 'adapter', x: 815, y: 390, w: 310, h: 128,
    owner: 'pi-ai · src/api/*', title: 'API implementation', lines: [
      'convert Context -> provider request',
      'call SDK / fetch',
      'map provider events -> Pi events',
    ],
  },
  {
    id: 'transport', x: 760, y: 625, w: 190, h: 102,
    owner: 'process dependency', title: 'Provider SDK / fetch', lines: ['HTTP transport', 'native stream /', 'Response.body'],
  },
  {
    id: 'network', x: 1010, y: 625, w: 165, h: 86,
    owner: 'external service', title: 'Provider HTTP API', lines: ['OpenAI / Anthropic', 'network boundary'], external: true,
  },
];

const variants = {
  'topology-provider.svg': {
    title: 'Provider 文章：一次模型调用中的位置',
    detail: 'Models 按 model.provider 找到 Provider；Provider 再按 model.api 分派到协议实现。',
    focus: ['provider'], related: ['models', 'stream', 'adapter', 'transport', 'network'],
  },
  'topology-event-stream.svg': {
    title: 'EventStream 文章：统一返回协议的位置',
    detail: 'API 实现创建并写入 EventStream；runAgentLoop 只消费 Pi 事件，不读取 Provider 原生事件。',
    focus: ['events'], related: ['adapter', 'loop', 'stream'],
  },
  'topology-openai-conversion.svg': {
    title: 'OpenAI 消息转换：协议实现内部的位置',
    detail: 'Context 到 Responses input 的转换属于 API implementation，不属于 Provider 或 Agent Loop。',
    focus: ['adapter'], related: ['provider', 'transport', 'network'],
  },
  'topology-openai-text-state.svg': {
    title: 'OpenAI 文本状态机：协议实现内部的位置',
    detail: 'API implementation 用 output_index 维护正在形成的 AssistantMessage，再把最终状态写入统一返回协议。',
    focus: ['adapter'], related: ['events', 'transport', 'network'],
  },
  'topology-openai-text-events.svg': {
    title: 'OpenAI 文本事件：Provider 原生事件到 Pi 事件的位置',
    detail: 'API implementation 发布 text_start、text_delta、text_end；EventStream 把它们交给 runAgentLoop。',
    focus: ['adapter', 'events'], related: ['loop', 'transport', 'network'],
  },
  'topology-openai-tool-state.svg': {
    title: 'OpenAI ToolCall 状态：协议转换内部的位置',
    detail: 'API implementation 累积 function_call 参数并生成 ToolCall；此处还没有本地工具执行。',
    focus: ['adapter'], related: ['events', 'tools'],
  },
  'topology-openai-tool-events.svg': {
    title: 'OpenAI ToolCall 事件：表示与执行边界',
    detail: 'API implementation 发布 toolcall 事件和 toolUse；runAgentLoop 的工具分支负责后续校验与执行。',
    focus: ['adapter', 'events'], related: ['loop', 'tools'],
  },
  'topology-anthropic-request.svg': {
    title: 'Anthropic 请求：协议实现到网络的位置',
    detail: 'Anthropic API implementation 构造 Messages request，再通过 SDK / fetch 访问外部 HTTP API。',
    focus: ['adapter'], related: ['provider', 'transport', 'network'],
  },
  'topology-anthropic-frames.svg': {
    title: 'Anthropic SSE 分帧：传输与协议解析的交界',
    detail: 'SDK / fetch 交付字节或原生流；API implementation 恢复 SSE frame，再映射 Anthropic event。',
    focus: ['adapter', 'transport'], related: ['network', 'events'],
  },
  'topology-anthropic-bytes.svg': {
    title: 'Anthropic 字节流：网络返回路径中的位置',
    detail: 'HTTP 响应经 SDK / fetch 进入进程；TextDecoder 与跨 chunk 缓冲属于 API implementation。',
    focus: ['adapter', 'transport'], related: ['network', 'events'],
  },
  'topology-anthropic-events.svg': {
    title: 'Anthropic 事件解码：SSE 帧到 Provider event 的位置',
    detail: 'API implementation 从 Response.body 恢复 SSE 帧，再筛选事件名、解析 JSON 并检查消息生命周期。',
    focus: ['adapter'], related: ['transport', 'network', 'events'],
  },
  'topology-model-types.svg': {
    title: 'Model / ProviderId / Api：分派协议中的位置',
    detail: 'model.provider 供 Models 查找 Provider；model.api 供 Provider 选择 API implementation。',
    focus: ['models', 'provider', 'adapter'], related: [],
  },
  'topology-auth.svg': {
    title: 'Auth：参考 Pi 在 Provider 调用前的解析位置',
    detail: '参考 Pi 由 Models 解析 Provider 的认证策略；当前项目只完成策略与请求结果类型，尚未自动接线。',
    focus: ['models'], related: ['provider', 'adapter'],
  },
  'topology-openai-wrapper.svg': {
    title: 'OpenAI wrapper：请求与返回的闭环位置',
    detail: 'API implementation 组装请求并调用 SDK；Provider 原生流返回后被转换成 Pi EventStream。',
    focus: ['adapter', 'transport', 'events'], related: ['network', 'provider', 'loop'],
  },
};

await mkdir(outputDir, { recursive: true });
for (const name of await readdir(outputDir)) {
  if (name.startsWith('topology-') && name.endsWith('.svg') && !Object.hasOwn(variants, name)) {
    await unlink(path.join(outputDir, name));
  }
}
for (const [name, variant] of Object.entries(variants)) {
  await writeFile(path.join(outputDir, name), render(variant));
}

function render(variant) {
  const nodeSvg = nodes.map((node) => renderNode(node, variant)).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 790" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(variant.title)}</title>
  <desc id="desc">${escapeXml(variant.detail)}</desc>
  <defs>
    <marker id="arrow-call" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#52606d"/>
    </marker>
    <marker id="arrow-return" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#167565"/>
    </marker>
  </defs>
  <style>
    .heading { font: 700 23px Inter, 'Noto Sans SC', sans-serif; fill: #171a1f; }
    .detail { font: 14px Inter, 'Noto Sans SC', sans-serif; fill: #56616d; }
    .section { font: 700 11px 'SFMono-Regular', Consolas, monospace; fill: #6b7783; }
    .guide { stroke: #e2e7eb; stroke-width: 1; stroke-dasharray: 4 5; }
    .node { fill: #ffffff; stroke: #bdc7d0; stroke-width: 1.5; }
    .node.external { fill: #e8f1f8; stroke: #5f87aa; }
    .node.contract { fill: #f2f7f5; stroke: #6e978d; }
    .node.sidecar { fill: #f6f7f8; stroke: #aab4bd; }
    .node.active { fill: #dff1eb; stroke: #0f6b5b; stroke-width: 2.5; }
    .node.related { fill: #fff5d9; stroke: #a97312; stroke-width: 1.8; stroke-dasharray: 5 4; }
    .owner { font: 700 10px 'SFMono-Regular', Consolas, monospace; fill: #70808d; }
    .node-title { font: 700 14px Inter, 'Noto Sans SC', sans-serif; fill: #20262c; }
    .node-note { font: 12px Inter, 'Noto Sans SC', sans-serif; fill: #606c77; }
    .call { fill: none; stroke: #52606d; stroke-width: 1.8; marker-end: url(#arrow-call); }
    .return { fill: none; stroke: #167565; stroke-width: 1.8; stroke-dasharray: 6 4; marker-end: url(#arrow-return); }
    .ownership { fill: none; stroke: #8b98a4; stroke-width: 1.4; stroke-dasharray: 3 4; marker-end: url(#arrow-call); }
    .edge-label { font: 11px Inter, 'Noto Sans SC', sans-serif; fill: #5f6c77; paint-order: stroke; stroke: #ffffff; stroke-width: 4px; stroke-linejoin: round; }
    .return-label { fill: #167565; }
    .legend { font: 12px Inter, 'Noto Sans SC', sans-serif; fill: #56616d; }
  </style>
  <rect width="1200" height="790" fill="#ffffff"/>
  <text x="28" y="34" class="heading">${escapeXml(variant.title)}</text>
  <text x="28" y="58" class="detail">${escapeXml(variant.detail)}</text>

  <line x1="28" y1="560" x2="1172" y2="560" class="guide"/>
  <text x="28" y="584" class="section">PROCESS / NETWORK BOUNDARY</text>

  <!-- Agent and AgentHarness are sibling entrypoints. Neither wraps the other. -->
  <path d="M225 151 H265 V194 H305" class="call"/>
  <path d="M225 282 H265 V232 H305" class="call"/>
  <text x="236" y="143" class="edge-label">prompt / continue</text>
  <text x="238" y="273" class="edge-label">prompt</text>

  <!-- runAgentLoop depends on an injected port; Harness creates a Models-backed implementation. -->
  <path d="M520 213 H585" class="call"/>
  <text x="531" y="203" class="edge-label">call</text>
  <path d="M745 213 H805" class="call"/>
  <text x="753" y="203" class="edge-label">Harness</text>
  <path d="M965 213 H1025" class="call"/>
  <text x="974" y="203" class="edge-label">delegate</text>

  <!-- Provider dispatches by model.api; the API module owns protocol conversion and transport use. -->
  <path d="M1100 260 V355 H1060 V390" class="call"/>
  <text x="1076" y="349" class="edge-label">model.api</text>
  <path d="M895 518 V590 H855 V625" class="call"/>
  <text x="874" y="585" class="edge-label">SDK call</text>
  <path d="M950 668 H1010" class="call"/>
  <text x="967" y="657" class="edge-label">HTTP</text>

  <!-- Native provider events return to the API implementation. -->
  <path d="M1010 692 H950" class="return"/>
  <text x="956" y="715" class="edge-label return-label">response</text>
  <path d="M830 625 V548 H1035 V518" class="return"/>
  <text x="846" y="543" class="edge-label return-label">SDK async iterable / Response.body</text>

  <!-- The API module translates native events into the uniform Pi stream. -->
  <path d="M815 469 H755" class="return"/>
  <text x="763" y="458" class="edge-label return-label">Pi events</text>
  <path d="M660 420 V260" class="return"/>
  <text x="670" y="350" class="edge-label return-label">returns EventStream</text>
  <path d="M585 239 H520" class="return"/>
  <text x="526" y="254" class="edge-label return-label">consume</text>

  <!-- Tool execution is an internal loop concern, not an API-adapter layer. -->
  <path d="M365 260 V385 H350 V420" class="call"/>
  <text x="296" y="380" class="edge-label">ToolCall</text>
  <path d="M470 420 V385 H475 V260" class="return"/>
  <text x="431" y="402" class="edge-label return-label">ToolResult</text>

  <!-- Session is Harness-owned state beside the call path. -->
  <path d="M105 345 V420" class="ownership"/>
  <text x="115" y="382" class="edge-label">build / append</text>
  <path d="M175 420 V345" class="return"/>
  <text x="185" y="402" class="edge-label return-label">context</text>

  ${nodeSvg}

  <line x1="28" y1="765" x2="82" y2="765" class="call"/>
  <text x="91" y="769" class="legend">调用 / 请求</text>
  <line x1="190" y1="765" x2="244" y2="765" class="return"/>
  <text x="253" y="769" class="legend">事件 / 返回</text>
  <rect x="357" y="757" width="12" height="12" rx="2" fill="#dff1eb" stroke="#0f6b5b"/>
  <text x="376" y="769" class="legend">本篇位置</text>
  <rect x="468" y="757" width="12" height="12" rx="2" fill="#fff5d9" stroke="#a97312" stroke-dasharray="3 2"/>
  <text x="487" y="769" class="legend">相关边界</text>
  <rect x="588" y="757" width="12" height="12" rx="2" fill="#e8f1f8" stroke="#5f87aa"/>
  <text x="607" y="769" class="legend">外部服务</text>
</svg>`;
}

function renderNode(node, variant) {
  const stateClass = variant.focus.includes(node.id)
    ? 'active'
    : variant.related.includes(node.id)
      ? 'related'
      : node.external
        ? 'external'
        : node.contract
          ? 'contract'
          : node.sidecar
            ? 'sidecar'
            : '';
  const titleLines = node.titleLines ?? [node.title];
  const titleSvg = titleLines.map((line, index) =>
    `<text x="${node.x + 12}" y="${node.y + 38 + index * 17}" class="node-title">${escapeXml(line)}</text>`,
  ).join('\n');
  const noteStart = node.y + 54 + (titleLines.length - 1) * 18;
  const lines = node.lines.map((line, index) =>
    `<text x="${node.x + 12}" y="${noteStart + index * 16}" class="node-note">${escapeXml(line)}</text>`,
  ).join('\n');
  return `<g>
    <title>${escapeXml(node.title)}</title>
    <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="6" class="node ${stateClass}"/>
    <text x="${node.x + 12}" y="${node.y + 17}" class="owner">${escapeXml(node.owner)}</text>
    ${titleSvg}
    ${lines}
  </g>`;
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
