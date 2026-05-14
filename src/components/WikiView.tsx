import { useState, useEffect, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Artifact, ArtifactVersion, Plan } from '../types';
import api from '../api';
import type { WikiFile, ArtifactHit } from '../api';
import { Button, Modal, Input, Textarea, Select, Label } from './ui';

interface WikiViewProps {
  projectId: string;
}

interface FileEntry {
  type: 'file';
  path: string;
  name: string;
  title?: string;
  modified_at: number;
  wiki_root?: string;
}

interface FileTreeNode {
  name: string;
  path?: string;
  children: FileTreeNode[];
}

function buildFileTree(files: FileEntry[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', children: [] };

  for (const f of files) {
    const parts = f.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current.children.push({ name: part, path: f.path, children: [] });
      } else {
        let folder = current.children.find(c => c.name === part && !c.path);
        if (!folder) {
          folder = { name: part, children: [] };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((a, b) => {
      const aIsFolder = !a.path;
      const bIsFolder = !b.path;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    });
    for (const n of nodes) {
      if (n.children.length > 0) sortNodes(n.children);
    }
    return nodes;
  };
  return sortNodes(root.children);
}

interface ArtifactNode extends Artifact {
  children: ArtifactNode[];
}

function buildTree(artifacts: Artifact[]): ArtifactNode[] {
  const map = new Map<string, ArtifactNode>();
  const roots: ArtifactNode[] = [];

  for (const a of artifacts) {
    map.set(a.id, { ...a, children: [] });
  }

  for (const node of map.values()) {
    const parentId = (node as unknown as { parent_id?: string }).parent_id;
    if (parentId && map.has(parentId)) {
      map.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Text highlight helper — FIX-WEB-004
// ---------------------------------------------------------------------------

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) ? (
          <mark key={i} className="bg-warning/30 text-foreground rounded-sm">{part}</mark>
        ) : (
          part
        )
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tree components
// ---------------------------------------------------------------------------

function TreeItem({
  node,
  selectedId,
  onSelect,
  onAddChild,
  searchQuery,
  depth = 0,
}: {
  node: ArtifactNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild?: (parentId: string) => void;
  searchQuery?: string;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  // US-CLAWKET-WEB-WIKI-005 — prefer the daemon-supplied `wiki_depth` when
  // present (FIX-DAEMON-008). It survives orphan / cross-plan rebuilds where
  // the parent_id chain alone gives wrong indentation. Fall back to recursive
  // depth when the field is absent (older daemon).
  const effectiveDepth = node.wiki_depth ?? depth;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 py-1.5 px-2 rounded-md text-sm transition-colors cursor-pointer ${
          selectedId === node.id
            ? 'bg-primary/15 text-primary'
            : 'text-foreground hover:bg-surface-hover'
        }`}
        style={{ paddingLeft: `${effectiveDepth * 16 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren && (
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="w-4 text-center text-muted hover:text-foreground cursor-pointer"
          >
            {expanded ? '▾' : '▸'}
          </span>
        )}
        {!hasChildren && <span className="w-4" />}
        <span className="text-xs text-muted mr-1">
          {node.content_format === 'markdown' ? '≣' : node.content_format === 'json' ? '{}' : '≡'}
        </span>
        <span className="truncate flex-1">
          {searchQuery ? highlight(node.title, searchQuery) : node.title}
        </span>
        {onAddChild && (
          <span
            onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
            className="text-xs text-muted hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer px-1"
            title="Add child document"
          >+</span>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <TreeItem
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              searchQuery={searchQuery}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileTreeView({
  nodes,
  selectedFile,
  onSelect,
  depth = 0,
}: {
  nodes: FileTreeNode[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isFolder = !node.path && node.children.length > 0;
        if (isFolder) {
          return (
            <FileFolder key={node.name} node={node} selectedFile={selectedFile} onSelect={onSelect} depth={depth} />
          );
        }
        return (
          <button
            key={node.path}
            onClick={() => node.path && onSelect(node.path)}
            className={`w-full text-left py-1 px-2 rounded-md text-sm transition-colors flex items-center gap-1 cursor-pointer ${
              selectedFile === node.path ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-surface-hover'
            }`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            <span className="text-xs text-muted">{'≡'}</span>
            <span className="truncate text-xs">{node.name}</span>
          </button>
        );
      })}
    </>
  );
}

function FileFolder({
  node,
  selectedFile,
  onSelect,
  depth,
}: {
  node: FileTreeNode;
  selectedFile: string | null;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left py-1 px-2 rounded-md text-xs text-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="w-3 text-center">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">{node.name}/</span>
        <span className="text-[10px]">({node.children.length})</span>
      </button>
      {expanded && (
        <FileTreeView nodes={node.children} selectedFile={selectedFile} onSelect={onSelect} depth={depth + 1} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content renderer — FIX-WEB-004: highlight search terms in markdown source
// US-CLAWKET-WEB-WIKI-005: minimal token highlighting for content_format='code'
// ---------------------------------------------------------------------------

/** Minimal hljs-compatible token highlighter — pattern-based, no parser, no
 *  external dep. Recognises a coarse JS/JSON/YAML keyword set + strings +
 *  numbers + comments. The CSS class names mirror highlight.js's defaults so
 *  any future migration to the real package is a drop-in swap.
 *
 *  Trade-off (LM-8 bundle budget): highlight.js is ~80 kB minified and would
 *  blow our 700 kB cap. The cost of false positives in this regex pass is
 *  acceptable for the wiki preview use case. */
const TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(-?\b\d+(?:\.\d+)?\b)|(\b(?:const|let|var|function|return|if|else|for|while|true|false|null|undefined|class|extends|new|this|import|export|from|as|async|await|throw|try|catch|finally|null|true|false)\b)/g;

function highlightCode(source: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(source)) !== null) {
    if (m.index > last) out.push(source.slice(last, m.index));
    const [, comment, str, num, kw] = m;
    if (comment) out.push(<span key={out.length} className="hljs-comment">{comment}</span>);
    else if (str) out.push(<span key={out.length} className="hljs-string">{str}</span>);
    else if (num) out.push(<span key={out.length} className="hljs-number">{num}</span>);
    else if (kw) out.push(<span key={out.length} className="hljs-keyword">{kw}</span>);
    last = m.index + m[0].length;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}

function ContentRenderer({
  content,
  format,
}: {
  content: string;
  format: string;
  searchQuery?: string;
}) {
  // For markdown, highlight is applied at the title/header level via highlight().
  // Rendered markdown can't reliably highlight without an AST walker — kept
  // as a prop for API symmetry so callers can pass it without conditional checks.

  // US-CLAWKET-WEB-WIKI-005 — `code` format: lightweight token highlighting.
  // We also map `json`/`yaml` through the same path because the daemon may
  // ship them as plain text and the user expects coloured tokens.
  if (format === 'code' || format === 'json' || format === 'yaml') {
    const langClass =
      format === 'code' ? 'hljs-plaintext' : format === 'json' ? 'hljs-json' : 'hljs-yaml';
    return (
      <pre className="bg-surface-high rounded-lg p-4 text-sm overflow-x-auto whitespace-pre-wrap">
        <code className={`font-mono text-foreground ${langClass}`}>
          {highlightCode(content)}
        </code>
      </pre>
    );
  }

  return (
    <div className="prose prose-sm max-w-none">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

function VersionHistory({
  artifactId,
  onRestore,
}: {
  artifactId: string;
  onRestore: (content: string) => void;
}) {
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.fetchArtifactVersions(artifactId)
      .then(data => { if (!cancelled) setVersions(data); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [artifactId]);

  if (loading) return <div className="text-xs text-muted py-2">Loading versions...</div>;
  if (versions.length === 0) return <div className="text-xs text-muted py-2">No version history</div>;

  return (
    <div className="space-y-1">
      {versions.map(v => (
        <div key={v.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded hover:bg-surface-hover">
          <div className="flex items-center gap-2">
            <span className="text-muted">v{v.version}</span>
            <span className="text-foreground">
              {(() => {
                if (!v.created_at) return '-';
                const d = new Date(v.created_at);
                return Number.isFinite(d.getTime()) ? d.toLocaleString() : '-';
              })()}
            </span>
            {v.created_by && <span className="text-muted">by {v.created_by}</span>}
          </div>
          {v.content && (
            <button
              onClick={() => onRestore(v.content!)}
              className="text-primary hover:underline cursor-pointer"
            >
              Restore
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main WikiView — FIX-WEB-004
// ---------------------------------------------------------------------------

export default function WikiView({ projectId }: WikiViewProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<WikiFile | null>(null);
  const [projectCwd, setProjectCwd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  // WIKI-VIEW-V3: search
  const [searchQuery, setSearchQuery] = useState('');
  // Server-side hybrid search results (BM25 + vector). Populated when the
  // user types a non-empty query; null = either no query or daemon predates
  // FIX-DAEMON-010 (we then fall back to the client-side filter below).
  const [searchHits, setSearchHits] = useState<ArtifactHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newFormat, setNewFormat] = useState('markdown');
  const [newType, setNewType] = useState('document');

  const selected = artifacts.find(a => a.id === selectedId) || null;

  const loadArtifacts = useCallback(async () => {
    try {
      const [planList, project] = await Promise.all([
        api.listPlans({ project_id: projectId }),
        api.getProject(projectId),
      ]);
      setPlans(planList);
      const cwd = project?.cwds?.[0] || null;
      setProjectCwd(cwd);

      // Knowledge entries are RAG by definition (post-024 migration).
      // No scope query needed — daemon returns all visible knowledge rows.
      const unitResults = await Promise.all(
        planList.map(p => api.listUnits({ plan_id: p.id }))
      );
      const allUnits = unitResults.flat();
      const artifactResults = await Promise.all([
        ...planList.map(p => api.listArtifacts({ plan_id: p.id })),
        ...allUnits.map(u => api.listArtifacts({ unit_id: u.id })),
      ]);
      // Deduplicate by id
      const seen = new Set<string>();
      const all: Artifact[] = [];
      for (const a of artifactResults.flat()) {
        if (!seen.has(a.id)) { seen.add(a.id); all.push(a); }
      }
      setArtifacts(all);

      // Load project files
      if (cwd) {
        try {
          const wikiFiles = await api.listWikiFiles(cwd, projectId);
          setFiles(wikiFiles.map(f => ({
            type: 'file' as const,
            path: f.path,
            name: f.name,
            title: f.title,
            modified_at: f.modified_at,
            wiki_root: f.wiki_root,
          })));
        } catch { setFiles([]); }
      }
    } catch (err) {
      console.error('Failed to load artifacts:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    loadArtifacts();
  }, [loadArtifacts]);

  // WIKI-VIEW-V3 — debounced server-side hybrid search. Falls back to
  // client-side substring filter when the daemon predates FIX-DAEMON-010
  // and returns 404 for /knowledge/search.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchHits(null); setSearching(false); return; }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await api.searchArtifacts({
          q,
          limit: 50,
          mode: 'hybrid',
          project_id: projectId,
        });
        setSearchHits(res === null ? null : res.hits);
      } catch (err) {
        console.error('Knowledge search failed, falling back to client filter:', err);
        setSearchHits(null);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [searchQuery, projectId]);

  // Filtered + searched knowledge entries
  const displayedArtifacts = useMemo(() => {
    if (!searchQuery.trim()) return artifacts;
    if (searchHits) return searchHits;
    // Fallback: client-side substring filter (pre-FIX-DAEMON-010 daemon).
    const q = searchQuery.toLowerCase();
    return artifacts.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.content.toLowerCase().includes(q) ||
      a.type.toLowerCase().includes(q)
    );
  }, [artifacts, searchQuery, searchHits]);

  const tree = buildTree(displayedArtifacts);

  async function handleCreate() {
    if (!newTitle.trim()) return;
    try {
      const planId = plans[0]?.id;
      if (!planId) return;
      await api.createArtifact({
        plan_id: planId,
        type: newType,
        title: newTitle.trim(),
        content: newContent,
        content_format: newFormat,
        parent_id: createParentId || undefined,
      });
      setShowCreate(false);
      setCreateParentId(null);
      setNewTitle('');
      setNewContent('');
      await loadArtifacts();
    } catch (err) {
      console.error('Failed to create artifact:', err);
    }
  }

  async function handleSelectFile(path: string) {
    setSelectedId(null);
    setSelectedFile(path);
    if (projectCwd) {
      try {
        const file = await api.getWikiFile(projectCwd, path, projectId);
        setFileContent(file);
      } catch (err) {
        console.error('Failed to load file:', err);
        setFileContent(null);
      }
    }
  }

  function handleSelectArtifact(id: string) {
    setSelectedFile(null);
    setFileContent(null);
    setSelectedId(id);
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteArtifact(id);
      setSelectedId(null);
      await loadArtifacts();
    } catch (err) {
      console.error('Failed to delete artifact:', err);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted">
        Loading wiki...
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* Sidebar - artifact tree */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col">
        <div className="px-3 py-2.5 border-b border-border flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground shrink-0">Wiki</h3>
          <Button variant="ghost" size="sm" onClick={() => setShowCreate(true)}>
            + New
          </Button>
        </div>

        {/* FIX-WEB-004: Search bar */}
        <div className="px-2 py-1.5 border-b border-border">
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search docs…"
            className="w-full text-xs bg-surface-high rounded px-2 py-1 text-foreground placeholder:text-muted outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>

        <div className="flex-1 overflow-y-auto py-1 px-1">
          {/* Knowledge section */}
          {tree.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted font-medium">
                Knowledge ({displayedArtifacts.length})
              </div>
              {tree.map(node => (
                <TreeItem
                  key={node.id}
                  node={node}
                  selectedId={selectedId}
                  onSelect={handleSelectArtifact}
                  onAddChild={(parentId) => { setCreateParentId(parentId); setShowCreate(true); }}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          )}

          {/* Project files section (grouped by wiki_root) */}
          {files.length > 0 && (() => {
            const groups = new Map<string, FileEntry[]>();
            for (const f of files) {
              const root = f.wiki_root || 'docs';
              if (!groups.has(root)) groups.set(root, []);
              groups.get(root)!.push(f);
            }
            const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) =>
              a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
            );
            return sortedGroups.map(([root, groupFiles]) => (
              <div key={root}>
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted font-medium">
                  {root === '.' ? 'Root Files' : root} ({groupFiles.length})
                </div>
                <FileTreeView
                  nodes={buildFileTree(groupFiles)}
                  selectedFile={selectedFile}
                  onSelect={handleSelectFile}
                />
              </div>
            ));
          })()}

          {tree.length === 0 && files.length === 0 && (
            <div className="text-center py-6 text-xs text-muted">
              {searching
                ? `Searching "${searchQuery}"…`
                : searchQuery
                  ? `No results for "${searchQuery}"`
                  : 'No documents yet'}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {searchQuery ? highlight(selected.title, searchQuery) : selected.title}
                </h2>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                  <span>{selected.type}</span>
                  <span>{selected.content_format}</span>
                  <span>{(() => {
                    if (!selected.created_at) return '-';
                    const d = new Date(selected.created_at);
                    return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '-';
                  })()}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowVersions(!showVersions)}
                >
                  {showVersions ? 'Hide History' : 'History'}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleDelete(selected.id)}
                >
                  Delete
                </Button>
              </div>
            </div>

            {showVersions && (
              <div className="mb-4 bg-surface rounded-lg border border-border p-3">
                <h4 className="text-xs font-medium text-foreground mb-2">Version History</h4>
                <VersionHistory
                  artifactId={selected.id}
                  onRestore={(content) => {
                    console.log('Restore content:', content.slice(0, 100));
                  }}
                />
              </div>
            )}

            <div className="bg-surface rounded-lg border border-border p-6">
              <ContentRenderer
                content={selected.content}
                format={selected.content_format}
                searchQuery={searchQuery}
              />
            </div>
          </div>
        ) : fileContent ? (
          <div className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-foreground">{fileContent.name}</h2>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                <span>{fileContent.path}</span>
                <span>{fileContent.content_format}</span>
                {fileContent.modified_at && (() => {
                  const d = new Date(fileContent.modified_at);
                  return Number.isFinite(d.getTime()) ? (
                    <span>{d.toLocaleDateString()}</span>
                  ) : null;
                })()}
              </div>
            </div>
            <div className="bg-surface rounded-lg border border-border p-6">
              <ContentRenderer
                content={fileContent.content || ''}
                format={fileContent.content_format || 'markdown'}
                searchQuery={searchQuery}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center h-full text-muted text-sm">
            Select a document from the sidebar
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <Modal.Overlay onClose={() => setShowCreate(false)}>
          <Modal.Content>
            <Modal.Header>New Knowledge Entry</Modal.Header>
            <Modal.Body>
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Artifact title"
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    id="type"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                  >
                    <option value="document">Document</option>
                    <option value="decision">Decision</option>
                    <option value="wireframe">Wireframe</option>
                    <option value="api_spec">API Spec</option>
                    <option value="schema">Schema</option>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label htmlFor="format">Format</Label>
                  <Select
                    id="format"
                    value={newFormat}
                    onChange={(e) => setNewFormat(e.target.value)}
                  >
                    <option value="markdown">Markdown</option>
                    <option value="json">JSON</option>
                    <option value="yaml">YAML</option>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="content">Content</Label>
                <Textarea
                  id="content"
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Write content..."
                  rows={10}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button variant="primary" onClick={handleCreate}>Create</Button>
              </div>
            </Modal.Body>
          </Modal.Content>
        </Modal.Overlay>
      )}
    </div>
  );
}
