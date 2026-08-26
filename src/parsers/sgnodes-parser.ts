import { SGNode, SGTreeResult } from "../types/roku.js";

interface RawNodeItem {
  depth: number;
  node: SGNode;
}

export interface ParseSGNodesOptions {
  includeFields?: boolean;
  maxDepth?: number;
  filterId?: string;
}

export function parseSGNodes(
  rawText: string,
  options: ParseSGNodesOptions = {}
): SGTreeResult {
  const includeFields = options.includeFields ?? true;
  const maxDepth = options.maxDepth;
  const filterId = options.filterId?.toLowerCase();

  const lines = rawText.split(/\r?\n/);
  const items: RawNodeItem[] = [];

  let currentNode: SGNode | null = null;
  let currentDepth = 0;
  let totalNodes = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("SceneGraph Nodes") || trimmed.startsWith("===")) {
      continue;
    }

    // Check if line represents a node declaration
    // Examples: " Node: Group", "  - LayoutGroup", "  - Node: RowList", "Group", " - PosterGrid"
    const nodeMatch = line.match(/^(\s*)(?:-\s+)?(?:Node:\s*)?([A-Za-z0-9_]+)\s*$/);
    const isFieldLine = line.includes("=") || (trimmed.startsWith("osref") || trimmed.startsWith("bscref"));

    if (nodeMatch && !isFieldLine) {
      const leadingSpaces = nodeMatch[1].length;
      const nodeType = nodeMatch[2];

      // Ignore if it's just a field-like keyword on its own
      if (["osref", "bscref", "id", "subtype"].includes(nodeType.toLowerCase())) {
        continue;
      }

      currentNode = {
        type: nodeType,
        id: "",
        fields: {},
        children: [],
      };
      currentDepth = leadingSpaces;
      items.push({ depth: currentDepth, node: currentNode });
      totalNodes++;
      continue;
    }

    // Check for field assignments on the current node
    // Examples: id = "mainLayout", subtype = "LayoutGroup", osref = 2, bscref = 1, itemSize = [1728, 400]
    if (currentNode) {
      const fieldMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*[:=]\s*(.*)$/);
      if (fieldMatch) {
        const key = fieldMatch[1];
        let val = fieldMatch[2].trim();

        // Strip surrounding quotes if present
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }

        if (key === "id") {
          currentNode.id = val;
        } else if (key === "subtype") {
          currentNode.subtype = val;
        } else if (key === "osref") {
          currentNode.osref = parseInt(val, 10);
        } else if (key === "bscref") {
          currentNode.bscref = parseInt(val, 10);
        } else {
          if (!currentNode.fields) {
            currentNode.fields = {};
          }
          currentNode.fields[key] = val;
        }
      }
    }
  }

  // Build tree from raw items using stack based on depth
  const rootNodes: SGNode[] = [];
  const stack: RawNodeItem[] = [];

  for (const item of items) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      rootNodes.push(item.node);
    } else {
      stack[stack.length - 1].node.children.push(item.node);
    }

    stack.push(item);
  }

  // Helper to filter by ID
  function findNodeById(nodes: SGNode[], targetId: string): SGNode | null {
    for (const node of nodes) {
      if (node.id && node.id.toLowerCase() === targetId) {
        return node;
      }
      const found = findNodeById(node.children, targetId);
      if (found) return found;
    }
    return null;
  }

  let finalTree = rootNodes;
  if (filterId) {
    const matched = findNodeById(rootNodes, filterId);
    finalTree = matched ? [matched] : [];
  }

  // Apply maxDepth and includeFields filters
  function cleanTree(node: SGNode, currentLevel: number): SGNode {
    const cleaned: SGNode = {
      type: node.type,
      id: node.id,
      ...(node.subtype ? { subtype: node.subtype } : {}),
      ...(node.osref !== undefined ? { osref: node.osref } : {}),
      ...(node.bscref !== undefined ? { bscref: node.bscref } : {}),
      ...(includeFields && node.fields && Object.keys(node.fields).length > 0
        ? { fields: node.fields }
        : {}),
      children: [],
    };

    if (maxDepth === undefined || currentLevel < maxDepth) {
      cleaned.children = node.children.map((child) =>
        cleanTree(child, currentLevel + 1)
      );
    }

    return cleaned;
  }

  const processedTree = finalTree.map((root) => cleanTree(root, 1));

  // Count total nodes in final tree
  function countNodes(nodes: SGNode[]): number {
    let count = 0;
    for (const n of nodes) {
      count += 1 + countNodes(n.children);
    }
    return count;
  }

  return {
    total_nodes: filterId ? countNodes(processedTree) : totalNodes,
    captured_at: new Date().toISOString(),
    tree: processedTree,
  };
}
