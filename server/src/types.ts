export type Person = { did: string; name: string };

export type GraphNode = {
  id: string;
  type: string;
  text: string;
  description?: string;
  doi?: string;
  url?: string;
  anchor?: string;
};

export type GraphEdge = {
  relation: string;
  subject: string;
  object: string;
  anchor?: string;
};

export type GraphPaper = {
  title: string;
  doi?: string;
  authors?: unknown[];
};

export type Graph = {
  source: string;
  models: string[];
  paper: GraphPaper;
  nodes: GraphNode[];
  edges: GraphEdge[];
};
