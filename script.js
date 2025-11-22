const paletteSections = {
  sources: [
    {
      type: "SqlSource",
      label: "SQL Source",
      description: "Pull data via query",
      config: { query: "SELECT * FROM sales" },
    },
    {
      type: "CsvImport",
      label: "CSV Import",
      description: "Upload comma separated values",
      config: { path: "sample-data.csv" },
    },
  ],
  transforms: [
    {
      type: "Filter",
      label: "Filter Rows",
      description: "Keep rows matching a condition",
      config: { script: "row.amount >= 500" },
    },
    {
      type: "Lookup",
      label: "Lookup",
      description: "Enrich rows using a mapping table",
      config: { key: "status", mapping: "new:New,won:Closed Won,lost:Closed Lost" },
    },
    {
      type: "Aggregate",
      label: "Aggregate",
      description: "Summarize metrics by group",
      config: { groupBy: "region", metric: "sum(amount)" },
    },
  ],
  destinations: [
    {
      type: "CsvDestination",
      label: "CSV Output",
      description: "Persist rows as CSV",
      config: { fileName: "export.csv" },
    },
    {
      type: "WarehouseLoad",
      label: "Warehouse",
      description: "Load data into analytics store",
      config: { table: "fact_sales" },
    },
  ],
};

const workspace = document.getElementById("workspace");
const nodeLayer = document.getElementById("node-layer");
const connectionLayer = document.getElementById("connection-layer");
const inspectorContent = document.getElementById("inspector-content");
const runLog = document.getElementById("run-log");
const pipelineOutline = document.getElementById("pipeline-outline");

let nodes = [];
let connections = [];
let selectedNodeId = null;
let pendingConnection = null;
let showGrid = true;
let draggingNodeId = null;
let dragFrame = null;
let pendingPreviewPath = null;
let pendingPreviewGlow = null;

const sampleData = [
  { customer: "CloudCo", region: "West", amount: 850, status: "won" },
  { customer: "DataNation", region: "North", amount: 240, status: "new" },
  { customer: "Insight LLC", region: "West", amount: 600, status: "lost" },
  { customer: "WideWorld Importers", region: "East", amount: 920, status: "won" },
  { customer: "Blue Yonder", region: "South", amount: 460, status: "new" },
];

function init() {
  renderPalette();
  document.getElementById("run-preview").addEventListener("click", runPreview);
  document.getElementById("toggle-grid").addEventListener("click", () => {
    showGrid = !showGrid;
    workspace.classList.toggle("show-grid", showGrid);
  });

  workspace.addEventListener("click", () => {
    pendingConnection = null;
    resetPortHighlights();
    clearConnectionPreview();
    selectNode(null);
  });

  workspace.addEventListener("pointermove", (event) => {
    if (pendingConnection && !draggingNodeId) {
      renderConnectionPreview(event);
    }
  });

  workspace.addEventListener("pointerleave", () => {
    clearConnectionPreview();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pendingConnection) {
      pendingConnection = null;
      resetPortHighlights();
      clearConnectionPreview();
    }
  });
}

function renderPalette() {
  const sourceList = document.getElementById("source-list");
  const transformList = document.getElementById("transform-list");
  const destinationList = document.getElementById("destination-list");

  const addChip = (container, item) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<strong>${item.label}</strong><p class="muted">${item.description}</p>`;
    chip.addEventListener("click", () => addNode(item));
    container.appendChild(chip);
  };

  paletteSections.sources.forEach((item) => addChip(sourceList, item));
  paletteSections.transforms.forEach((item) => addChip(transformList, item));
  paletteSections.destinations.forEach((item) => addChip(destinationList, item));
}

function addNode(definition) {
  const node = {
    id: `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    type: definition.type,
    label: definition.label,
    description: definition.description,
    config: { ...definition.config },
    position: {
      x: 60 + nodes.length * 40,
      y: 60 + nodes.length * 30,
    },
  };
  nodes.push(node);
  renderNodes();
  selectNode(node.id);
}

function renderNodes() {
  nodeLayer.innerHTML = "";
  const template = document.getElementById("node-template");

  nodes.forEach((node) => {
    const fragment = template.content.cloneNode(true);
    const nodeEl = fragment.querySelector(".node");
    nodeEl.style.left = `${node.position.x}px`;
    nodeEl.style.top = `${node.position.y}px`;
    nodeEl.dataset.id = node.id;
    nodeEl.querySelector(".node-type").textContent = node.type;
    nodeEl.querySelector(".node-title").textContent = node.label;
    nodeEl.querySelector(".node-description").textContent = node.description;

    if (selectedNodeId === node.id) nodeEl.classList.add("selected");

    const inputPort = nodeEl.querySelector(".port.input");
    const outputPort = nodeEl.querySelector(".port.output");

    if (isSource(node)) inputPort.classList.add("hidden");
    if (isDestination(node)) outputPort.classList.add("hidden");

    enableDragging(nodeEl, node.id);

    nodeEl.addEventListener("click", (event) => {
      event.stopPropagation();
      selectNode(node.id);
    });

    outputPort.addEventListener("click", (event) => {
      event.stopPropagation();
      pendingConnection = { from: node.id };
      highlightConnectableInputs();
      renderConnectionPreview(event);
    });

    inputPort.addEventListener("click", (event) => {
      event.stopPropagation();
      if (pendingConnection) {
        createConnection(pendingConnection.from, node.id);
        pendingConnection = null;
        resetPortHighlights();
        clearConnectionPreview();
      }
    });

    nodeEl.querySelector(".node-delete").addEventListener("click", (event) => {
      event.stopPropagation();
      deleteNode(node.id);
    });

    nodeLayer.appendChild(fragment);
  });

  drawConnections();
  renderPipelineOutline();
}

function enableDragging(element, nodeId) {
  let isDragging = false;
  let offset = { x: 0, y: 0 };

  element.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button") || event.target.closest(".port")) return;
    isDragging = true;
    offset.x = event.clientX - element.offsetLeft;
    offset.y = event.clientY - element.offsetTop;
    element.setPointerCapture(event.pointerId);
    draggingNodeId = nodeId;
    event.preventDefault();
  });

  element.addEventListener("pointermove", (event) => {
    if (!isDragging) return;
    const x = event.clientX - offset.x;
    const y = event.clientY - offset.y;

    if (!dragFrame) {
      dragFrame = requestAnimationFrame(() => {
        updateNodePosition(nodeId, x, y);
        dragFrame = null;
      });
    }
  });

  element.addEventListener("pointerup", (event) => {
    if (!isDragging) return;
    isDragging = false;
    element.releasePointerCapture(event.pointerId);
    draggingNodeId = null;
    if (dragFrame) {
      cancelAnimationFrame(dragFrame);
      dragFrame = null;
      updateNodePosition(nodeId, event.clientX - offset.x, event.clientY - offset.y);
    }
  });
}

function updateNodePosition(id, x, y) {
  const node = nodes.find((n) => n.id === id);
  if (!node) return;
  node.position = { x, y };
  const el = nodeLayer.querySelector(`.node[data-id="${id}"]`);
  if (el) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
  drawConnections();
}

function isSource(node) {
  return ["SqlSource", "CsvImport"].includes(node.type);
}

function isDestination(node) {
  return ["CsvDestination", "WarehouseLoad"].includes(node.type);
}

function createConnection(from, to) {
  if (from === to) return;
  if (connections.some((c) => c.from === from && c.to === to)) return;
  const toHasConnection = connections.some((c) => c.to === to);
  if (toHasConnection && !isSource(nodes.find((n) => n.id === to))) {
    connections = connections.filter((c) => c.to !== to);
  }
  connections.push({ from, to });
  renderNodes();
}

function deleteNode(id) {
  nodes = nodes.filter((n) => n.id !== id);
  connections = connections.filter((c) => c.from !== id && c.to !== id);
  if (selectedNodeId === id) selectedNodeId = null;
  renderNodes();
  renderInspector();
}

function selectNode(id) {
  selectedNodeId = id;
  renderNodes();
  renderInspector();
}

function resetPortHighlights() {
  document.querySelectorAll(".port").forEach((port) => {
    port.classList.remove("connectable");
  });
}

function highlightConnectableInputs() {
  resetPortHighlights();
  connections
    .map((c) => c.to)
    .forEach((toId) => {
      const nodeEl = nodeLayer.querySelector(`.node[data-id="${toId}"]`);
      nodeEl?.querySelector(".port.input")?.classList.remove("connectable");
    });
  nodeLayer.querySelectorAll(".port.input").forEach((port) => {
    port.classList.add("connectable");
  });
}

function drawConnections() {
  connectionLayer.innerHTML = "";
  const svgRect = connectionLayer.getBoundingClientRect();

  connections.forEach((conn) => {
    const fromNode = nodeLayer.querySelector(`.node[data-id="${conn.from}"]`);
    const toNode = nodeLayer.querySelector(`.node[data-id="${conn.to}"]`);
    if (!fromNode || !toNode) return;

    const fromPort = fromNode.querySelector(".port.output").getBoundingClientRect();
    const toPort = toNode.querySelector(".port.input").getBoundingClientRect();

    const startX = fromPort.left - svgRect.left + fromPort.width / 2;
    const startY = fromPort.top - svgRect.top + fromPort.height / 2;
    const endX = toPort.left - svgRect.left + toPort.width / 2;
    const endY = toPort.top - svgRect.top + toPort.height / 2;

    const controlOffset = Math.abs(endX - startX) * 0.45 + 40;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      `M ${startX} ${startY} C ${startX + controlOffset} ${startY} ${endX - controlOffset} ${endY} ${endX} ${endY}`
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "url(#accent-gradient)");
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("opacity", "0.9");

    const glow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    glow.setAttribute(
      "d",
      `M ${startX} ${startY} C ${startX + controlOffset} ${startY} ${endX - controlOffset} ${endY} ${endX} ${endY}`
    );
    glow.setAttribute("fill", "none");
    glow.setAttribute("stroke", "rgba(125,223,242,0.3)");
    glow.setAttribute("stroke-width", "9");
    glow.setAttribute("stroke-linecap", "round");

    connectionLayer.appendChild(glow);
    connectionLayer.appendChild(path);
  });

  if (pendingPreviewPath && pendingPreviewGlow) {
    connectionLayer.appendChild(pendingPreviewGlow);
    connectionLayer.appendChild(pendingPreviewPath);
  }
}

function clearConnectionPreview() {
  pendingPreviewGlow = null;
  pendingPreviewPath = null;
  drawConnections();
}

function renderConnectionPreview(event) {
  const fromNode = nodeLayer.querySelector(`.node[data-id="${pendingConnection?.from}"]`);
  if (!fromNode) return;

  const fromPort = fromNode.querySelector(".port.output").getBoundingClientRect();
  const svgRect = connectionLayer.getBoundingClientRect();
  const startX = fromPort.left - svgRect.left + fromPort.width / 2;
  const startY = fromPort.top - svgRect.top + fromPort.height / 2;
  const endX = event.clientX - svgRect.left;
  const endY = event.clientY - svgRect.top;
  const controlOffset = Math.abs(endX - startX) * 0.45 + 40;

  pendingPreviewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pendingPreviewPath.setAttribute(
    "d",
    `M ${startX} ${startY} C ${startX + controlOffset} ${startY} ${endX - controlOffset} ${endY} ${endX} ${endY}`
  );
  pendingPreviewPath.setAttribute("fill", "none");
  pendingPreviewPath.setAttribute("stroke", "url(#accent-gradient)");
  pendingPreviewPath.setAttribute("stroke-width", "2.5");
  pendingPreviewPath.setAttribute("stroke-dasharray", "6 6");
  pendingPreviewPath.setAttribute("opacity", "0.8");
  pendingPreviewPath.classList.add("connection-preview");

  pendingPreviewGlow = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pendingPreviewGlow.setAttribute(
    "d",
    `M ${startX} ${startY} C ${startX + controlOffset} ${startY} ${endX - controlOffset} ${endY} ${endX} ${endY}`
  );
  pendingPreviewGlow.setAttribute("fill", "none");
  pendingPreviewGlow.setAttribute("stroke", "rgba(125,223,242,0.18)");
  pendingPreviewGlow.setAttribute("stroke-width", "9");

  drawConnections();
}

function renderInspector() {
  inspectorContent.innerHTML = "";
  if (!selectedNodeId) {
    const placeholder = document.createElement("p");
    placeholder.className = "muted";
    placeholder.textContent = "Select a node to view or edit its settings.";
    inspectorContent.appendChild(placeholder);
    return;
  }

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) return;

  const title = document.createElement("h3");
  title.textContent = node.label;
  inspectorContent.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "muted";
  desc.textContent = node.description;
  inspectorContent.appendChild(desc);

  Object.entries(node.config).forEach(([key, value]) => {
    const wrapper = document.createElement("div");
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = key;
    const input = document.createElement(key.includes("query") ? "textarea" : "input");
    input.value = value;
    input.addEventListener("input", (event) => {
      node.config[key] = event.target.value;
    });
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    inspectorContent.appendChild(wrapper);
  });
}

function renderPipelineOutline() {
  pipelineOutline.innerHTML = "";
  if (connections.length === 0) {
    pipelineOutline.innerHTML = '<p class="muted">Connect nodes to see lineage.</p>';
    return;
  }
  connections.forEach((conn) => {
    const from = nodes.find((n) => n.id === conn.from);
    const to = nodes.find((n) => n.id === conn.to);
    if (!from || !to) return;
    const item = document.createElement("div");
    item.className = "outline-item";
    item.innerHTML = `<strong>${from.label}</strong> → ${to.label}`;
    pipelineOutline.appendChild(item);
  });
}

function getIncomingConnection(nodeId) {
  return connections.find((c) => c.to === nodeId);
}

function executeNode(node, upstreamData) {
  const log = (message) => appendLog(message);

  switch (node.type) {
    case "SqlSource":
      log(`Executed SQL: ${node.config.query}`);
      return sampleData;
    case "CsvImport":
      log(`Imported CSV from ${node.config.path}`);
      return sampleData;
    case "Filter": {
      log(`Filtering rows with: ${node.config.script}`);
      try {
        const filterFn = new Function("row", `return ${node.config.script}`);
        return upstreamData.filter((row) => {
          try {
            return !!filterFn(row);
          } catch (err) {
            console.warn("Filter error", err);
            return false;
          }
        });
      } catch (error) {
        log("Filter script invalid; skipping filter.");
        return upstreamData;
      }
    }
    case "Lookup": {
      const mapping = Object.fromEntries(
        node.config.mapping.split(",").map((pair) => pair.split(":"))
      );
      log(`Lookup on key ${node.config.key}`);
      return upstreamData.map((row) => ({
        ...row,
        [`${node.config.key}_label`]: mapping[row[node.config.key]] ?? row[node.config.key],
      }));
    }
    case "Aggregate": {
      const groupBy = node.config.groupBy || "region";
      log(`Aggregating by ${groupBy} using ${node.config.metric}`);
      const groups = {};
      upstreamData.forEach((row) => {
        const key = row[groupBy] ?? "unknown";
        groups[key] = groups[key] || { group: key, amount: 0, count: 0 };
        groups[key].amount += Number(row.amount) || 0;
        groups[key].count += 1;
      });
      return Object.values(groups);
    }
    case "CsvDestination":
      log(`Writing ${upstreamData.length} rows to ${node.config.fileName}`);
      return upstreamData;
    case "WarehouseLoad":
      log(`Loading into table ${node.config.table}`);
      return upstreamData;
    default:
      return upstreamData;
  }
}

function topologicalNodes() {
  const indegree = new Map();
  nodes.forEach((node) => indegree.set(node.id, 0));
  connections.forEach((c) => {
    indegree.set(c.to, (indegree.get(c.to) || 0) + 1);
  });

  const queue = nodes.filter((n) => indegree.get(n.id) === 0);
  const ordered = [];

  while (queue.length) {
    const node = queue.shift();
    ordered.push(node);
    connections
      .filter((c) => c.from === node.id)
      .forEach((c) => {
        indegree.set(c.to, indegree.get(c.to) - 1);
        if (indegree.get(c.to) === 0) {
          const nextNode = nodes.find((n) => n.id === c.to);
          if (nextNode) queue.push(nextNode);
        }
      });
  }

  return ordered;
}

function runPreview() {
  runLog.innerHTML = "";
  const ordered = topologicalNodes();
  const outputs = new Map();
  let lastResult = [];

  ordered.forEach((node) => {
    const incoming = getIncomingConnection(node.id);
    const upstream = incoming ? outputs.get(incoming.from) || [] : [];
    const result = executeNode(node, upstream);
    outputs.set(node.id, result);
    lastResult = result;
  });

  appendLog("Preview complete. Inspect resulting rows in console for more detail.");
  console.table(lastResult);
}

function appendLog(message) {
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = `${new Date().toLocaleTimeString()}  •  ${message}`;
  runLog.appendChild(entry);
  runLog.scrollTop = runLog.scrollHeight;
}

document.addEventListener("DOMContentLoaded", init);
