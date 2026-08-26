import { describe, it, expect } from "vitest";
import { parseSGNodes } from "../../../src/parsers/sgnodes-parser.js";

describe("sgnodes-parser", () => {
  it("parses empty or header-only output", () => {
    const output = "SceneGraph Nodes (all):\n\n";
    const result = parseSGNodes(output);
    expect(result.total_nodes).toBe(0);
    expect(result.tree).toEqual([]);
  });

  it("parses single root node with fields", () => {
    const raw = `
SceneGraph Nodes (all):

 Node: Group
   id = "mainGroup"
   subtype = "MainScene"
   osref = 2
   bscref = 1
   opacity = 1.0
`;
    const result = parseSGNodes(raw);
    expect(result.total_nodes).toBe(1);
    expect(result.tree).toHaveLength(1);
    expect(result.tree[0].type).toBe("Group");
    expect(result.tree[0].id).toBe("mainGroup");
    expect(result.tree[0].subtype).toBe("MainScene");
    expect(result.tree[0].osref).toBe(2);
    expect(result.tree[0].bscref).toBe(1);
    expect(result.tree[0].fields?.opacity).toBe("1.0");
  });

  it("parses nested hierarchical tree structure", () => {
    const raw = `
SceneGraph Nodes (all):

 Node: Group
   id = "root"
   subtype = "HomeScene"
   - LayoutGroup
     id = "mainLayout"
     translation = [0, 0]
     - RowList
       id = "homeRowList"
       itemSize = [1728, 400]
       numRows = 5
       - PosterGrid
         id = "grid_0"
`;
    const result = parseSGNodes(raw);
    expect(result.total_nodes).toBe(4);
    expect(result.tree).toHaveLength(1);

    const root = result.tree[0];
    expect(root.id).toBe("root");
    expect(root.children).toHaveLength(1);

    const layout = root.children[0];
    expect(layout.id).toBe("mainLayout");
    expect(layout.type).toBe("LayoutGroup");
    expect(layout.fields?.translation).toBe("[0, 0]");
    expect(layout.children).toHaveLength(1);

    const rowList = layout.children[0];
    expect(rowList.id).toBe("homeRowList");
    expect(rowList.type).toBe("RowList");
    expect(rowList.fields?.numRows).toBe("5");
    expect(rowList.children).toHaveLength(1);

    const grid = rowList.children[0];
    expect(grid.id).toBe("grid_0");
    expect(grid.type).toBe("PosterGrid");
  });

  it("filters tree by filterId", () => {
    const raw = `
Node: Root
  id = "root"
  - ChildA
    id = "target"
    - GrandChild
      id = "gc"
  - ChildB
    id = "other"
`;
    const result = parseSGNodes(raw, { filterId: "target" });
    expect(result.tree).toHaveLength(1);
    expect(result.tree[0].id).toBe("target");
    expect(result.tree[0].children).toHaveLength(1);
    expect(result.tree[0].children[0].id).toBe("gc");
  });

  it("applies maxDepth and includeFields options", () => {
    const raw = `
Node: Root
  id = "root"
  foo = "bar"
  - Child
    id = "child"
    baz = "qux"
    - GrandChild
      id = "grandchild"
`;
    const noFieldsResult = parseSGNodes(raw, { includeFields: false });
    expect(noFieldsResult.tree[0].fields).toBeUndefined();

    const maxDepthResult = parseSGNodes(raw, { maxDepth: 2 });
    expect(maxDepthResult.tree[0].children[0].children).toHaveLength(0);
  });
});
