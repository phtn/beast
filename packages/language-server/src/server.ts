#!/usr/bin/env node

import {
  createConnection,
  DidChangeWatchedFilesNotification,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { BeastLanguageService } from "./language-service.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const service = new BeastLanguageService();
const workspaceRoots = new Set<string>();
let supportsDynamicFileWatching = false;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const roots = params.workspaceFolders?.map((folder) => folder.uri)
    ?? (params.rootUri === null ? [] : [params.rootUri]);
  workspaceRoots.clear();
  for (const root of roots) workspaceRoots.add(root);
  service.setWorkspaceRoots(roots);
  supportsDynamicFileWatching =
    params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
  return {
    capabilities: {
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: [".", "/", "\"", "'", "("],
      },
      definitionProvider: true,
      documentLinkProvider: { resolveProvider: false },
      documentSymbolProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      textDocumentSync: TextDocumentSyncKind.Incremental,
      workspace: {
        workspaceFolders: {
          changeNotifications: true,
          supported: true,
        },
      },
    },
  };
});

connection.onInitialized(() => {
  void service.refresh();
  if (supportsDynamicFileWatching) {
    void connection.client.register(DidChangeWatchedFilesNotification.type, {
      watchers: [{ globPattern: "**/*.btsx" }],
    });
  }
  connection.workspace.onDidChangeWorkspaceFolders((event) => {
    for (const folder of event.removed) workspaceRoots.delete(folder.uri);
    for (const folder of event.added) workspaceRoots.add(folder.uri);
    service.setWorkspaceRoots([...workspaceRoots]);
    void service.refresh();
  });
});

documents.onDidOpen((event) => publishDiagnostics(event.document));
documents.onDidChangeContent((event) => publishDiagnostics(event.document));
documents.onDidSave(() => void service.refresh());
documents.onDidClose((event) => {
  void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.onDidChangeWatchedFiles(() => void service.refresh());

connection.onCompletion(async (params) => {
  const document = documents.get(params.textDocument.uri);
  return document === undefined ? [] : service.completions(document, params.position);
});

connection.onDefinition(async (params) => {
  const document = documents.get(params.textDocument.uri);
  return document === undefined ? [] : service.definitions(document, params.position);
});

connection.onDocumentLinks(async (params) => {
  const document = documents.get(params.textDocument.uri);
  return document === undefined ? [] : service.documentLinks(document);
});

connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  return document === undefined ? [] : service.documentSymbols(document);
});

connection.onHover(async (params) => {
  const document = documents.get(params.textDocument.uri);
  return document === undefined ? null : service.hover(document, params.position);
});

connection.onReferences(async (params) => {
  const document = documents.get(params.textDocument.uri);
  return document === undefined
    ? []
    : service.references(document, params.position, params.context.includeDeclaration);
});

async function publishDiagnostics(document: TextDocument): Promise<void> {
  await connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: service.diagnostics(document),
  });
}

documents.listen(connection);
connection.listen();
