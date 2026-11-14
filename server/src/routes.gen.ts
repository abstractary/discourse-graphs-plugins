// GENERATED FILE. Do not edit it by hand.
// It is a copy of the route table in packages/contract/src/routes.ts, written by scripts/gen-routes.mjs.
// Change the table there, then run `npm run gen:routes`. `npm run check:routes` fails when this copy is behind.
// The server keeps a copy because it stands alone and imports nothing from packages/.

export const ROUTES = {
  info: { method: 'GET', path: '/v1/info', group: 'Compute', client: true, description: 'Name, kind and version of the server, and whether it can answer with a model' },
  models: { method: 'GET', path: '/v1/models', group: 'Compute', client: true, description: 'The models the server can extract with' },
  schemas: { method: 'GET', path: '/v1/schemas', group: 'Compute', client: true, description: 'The schemas the server can extract into' },
  extract: { method: 'POST', path: '/v1/extract', group: 'Compute', client: true, description: 'Extract a graph from a document, as an NDJSON stream' },
  storeGraph: { method: 'POST', path: '/v1/graphs', group: 'Graph store', client: true, description: 'Keep the extraction graph of a paper that has a DOI' },
  listGraphs: { method: 'GET', path: '/v1/graphs', group: 'Graph store', client: false, description: 'List the stored graphs, or read one with `?doi=`' },
  work: { method: 'GET', path: '/works/*doi', group: 'Landing pages', client: false, description: 'Landing page of a stored paper, and its `graph.json`, `ro-crate-metadata.json` and `linkset.json`' },
  root: { method: 'GET', path: '/', group: 'Notifications', client: false, description: 'The front door: where the info and the inbox are' },
  sendNotification: { method: 'POST', path: '/v1/notify/inbox', group: 'Notifications', client: false, description: 'Take in a COAR Notify notification. A sender posts to the inbox address it found in a `Link` header' },
  notifications: { method: 'GET', path: '/v1/notify/inbox', group: 'Notifications', client: true, description: 'List the notifications received, newest first. `?about=` narrows it' },
  inboxOptions: { method: 'OPTIONS', path: '/v1/notify/inbox', group: 'Notifications', client: false, description: 'Say which content types the inbox takes' },
  readNotification: { method: 'GET', path: '/v1/notify/inbox/:key', group: 'Notifications', client: false, description: 'One stored notification, exactly as it was sent' },
  createLab: { method: 'POST', path: '/v1/labs', group: 'Labs', client: true, description: 'Make a lab. The creator becomes its admin' },
  findLab: { method: 'GET', path: '/v1/labs/:id', group: 'Labs', client: true, description: 'Id and name of a lab, to confirm it before asking to join' },
  askToJoin: { method: 'POST', path: '/v1/labs/:id/join', group: 'Labs', client: true, description: 'Ask to join a lab' },
  pollJoin: { method: 'GET', path: '/v1/labs/:id/join/:requestId', group: 'Labs', client: true, description: 'Whether a request to join was answered. Takes `?secret=`' },
  members: { method: 'GET', path: '/v1/labs/:id/members', group: 'Labs', client: true, description: 'The members of a lab' },
  requests: { method: 'GET', path: '/v1/labs/:id/requests', group: 'Labs', client: true, description: 'The pending requests to join' },
  decide: { method: 'POST', path: '/v1/labs/:id/requests/:requestId', group: 'Labs', client: true, description: 'Accept or decline a request to join' },
  createInvite: { method: 'POST', path: '/v1/labs/:id/invites', group: 'Labs', client: true, description: 'Make an invite code' },
  listInvites: { method: 'GET', path: '/v1/labs/:id/invites', group: 'Labs', client: true, description: 'The invites that still work, without their codes' },
  acceptInvite: { method: 'POST', path: '/v1/labs/:id/invites/accept', group: 'Labs', client: true, description: 'Join a lab with an invite code' },
  revokeInvite: { method: 'DELETE', path: '/v1/labs/:id/invites/:inviteId', group: 'Labs', client: true, description: 'Take back an invite' },
  removeMember: { method: 'DELETE', path: '/v1/labs/:id/members/:did', group: 'Labs', client: true, description: 'Remove a member and every token of theirs' },
  pushRecords: { method: 'POST', path: '/v1/labs/:id/records', group: 'Sync', client: true, description: 'Share records with the lab' },
  pullRecords: { method: 'GET', path: '/v1/labs/:id/records', group: 'Sync', client: true, description: 'Read what the lab shared. Takes `?after=` and `?limit=`' },
  uploadPaper: { method: 'POST', path: '/v1/labs/:id/papers', group: 'Lab papers', client: true, description: 'Add a paper, its graph and optionally its file to the lab' },
  labPapers: { method: 'GET', path: '/v1/labs/:id/papers', group: 'Lab papers', client: true, description: 'The papers of a lab' },
  getPaper: { method: 'GET', path: '/v1/labs/:id/papers/:paperId', group: 'Lab papers', client: false, description: 'One paper with its graph' },
  paperFile: { method: 'GET', path: '/v1/labs/:id/papers/:paperId/file', group: 'Lab papers', client: true, description: 'The original file of a paper' },
  leaveBreadcrumb: { method: 'POST', path: '/v1/labs/:id/papers/:paperId/breadcrumbs', group: 'Lab papers', client: true, description: 'Say that a person read this paper' },
  ask: { method: 'POST', path: '/v1/ai/ask', group: 'AI', client: true, description: 'Ask a question about the units on a canvas, as an NDJSON stream' },
} as const;

export type RouteName = keyof typeof ROUTES;
