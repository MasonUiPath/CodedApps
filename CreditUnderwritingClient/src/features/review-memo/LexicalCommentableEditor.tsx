import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { Box, IconButton, Paper, Stack, Typography } from '@mui/material';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { $createParagraphNode, $createTextNode, $getRoot, FORMAT_TEXT_COMMAND } from 'lexical';
import { INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';

type PendingCommentDraft = {
  taskId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  anchorX: number;
  anchorY: number;
};

type LexicalCommentableEditorProps = {
  taskId: string;
  value: string;
  height?: number | string;
  comments: Array<{
    id: string;
    startOffset: number;
    endOffset: number;
    quotedText: string;
    comment: string;
  }>;
  pendingDraft?: {
    startOffset: number;
    endOffset: number;
    quotedText: string;
  } | null;
  onValueChange: (nextValue: string) => void;
  onRangeSelected: (input: PendingCommentDraft) => void;
  onSelectionCleared?: () => void;
  onRemoveRevision?: (input: { revisionId: string; pending: boolean }) => void;
};

type HighlightVisual = {
  id: string;
  startOffset: number;
  endOffset: number;
  rects: Array<{ left: number; top: number; width: number; height: number }>;
  markerLeft: number;
  markerTop: number;
  tooltipClientLeft: number;
  tooltipClientTop: number;
  comment: string;
  pending: boolean;
};

function getTextOffsetFromPoint(root: HTMLElement, clientX: number, clientY: number): number | null {
  const doc = root.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let offsetNode: Node | null = null;
  let offset = 0;

  if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(clientX, clientY);
    if (!position) {
      return null;
    }
    offsetNode = position.offsetNode;
    offset = position.offset;
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (!range) {
      return null;
    }
    offsetNode = range.startContainer;
    offset = range.startOffset;
  }

  if (!offsetNode || !root.contains(offsetNode)) {
    return null;
  }

  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(offsetNode, offset);
  return pre.toString().length;
}

function getSelectionOffsetsWithinRoot(
  root: HTMLElement,
  selection: Selection,
): { startOffset: number; endOffset: number } | null {
  if (!selection.rangeCount) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }

  const preStart = document.createRange();
  preStart.selectNodeContents(root);
  preStart.setEnd(range.startContainer, range.startOffset);

  const preEnd = document.createRange();
  preEnd.selectNodeContents(root);
  preEnd.setEnd(range.endContainer, range.endOffset);

  const startOffset = preStart.toString().length;
  const endOffset = preEnd.toString().length;

  if (endOffset <= startOffset) {
    return null;
  }

  return { startOffset, endOffset };
}

function getRangeForOffsets(
  root: HTMLElement,
  startOffset: number,
  endOffset: number,
): Range | null {
  const fullTextLength = (root.textContent ?? '').length;
  if (fullTextLength === 0) {
    return null;
  }

  const clampedStart = Math.max(0, Math.min(startOffset, fullTextLength));
  const clampedEnd = Math.max(clampedStart + 1, Math.min(endOffset, fullTextLength));
  if (clampedEnd <= clampedStart) {
    return null;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentNode: Node | null = walker.nextNode();
  let cursor = 0;
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  let startNodeOffset = 0;
  let endNodeOffset = 0;

  while (currentNode) {
    const textLength = currentNode.textContent?.length ?? 0;
    const nextCursor = cursor + textLength;

    if (!startNode && clampedStart <= nextCursor) {
      startNode = currentNode;
      startNodeOffset = Math.max(0, clampedStart - cursor);
    }

    if (clampedEnd <= nextCursor) {
      endNode = currentNode;
      endNodeOffset = Math.max(0, clampedEnd - cursor);
      break;
    }

    cursor = nextCursor;
    currentNode = walker.nextNode();
  }

  if (!startNode || !endNode) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, startNodeOffset);
  range.setEnd(endNode, endNodeOffset);
  return range;
}

function ExternalTextSyncPlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext();
  const lastAppliedValueRef = useRef(value);

  useEffect(() => {
    if (value === lastAppliedValueRef.current) {
      return;
    }

    editor.update(() => {
      const root = $getRoot();
      const currentText = root.getTextContent();
      if (currentText === value) {
        return;
      }

      root.clear();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(value));
      root.append(paragraph);
    });

    lastAppliedValueRef.current = value;
  }, [editor, value]);

  return null;
}

function SelectionCapturePlugin({
  taskId,
  onRangeSelected,
  onSelectionCleared,
}: {
  taskId: string;
  onRangeSelected: (input: PendingCommentDraft) => void;
  onSelectionCleared?: () => void;
}) {
  const [editor] = useLexicalComposerContext();

  const handleSelectionCapture = () => {
    const rootElement = editor.getRootElement();
    if (!rootElement) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      onSelectionCleared?.();
      return;
    }

    const offsets = getSelectionOffsetsWithinRoot(rootElement, selection);
    if (!offsets) {
      onSelectionCleared?.();
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      onSelectionCleared?.();
      return;
    }

    const rangeRect = selection.getRangeAt(0).getBoundingClientRect();
    onRangeSelected({
      taskId,
      startOffset: offsets.startOffset,
      endOffset: offsets.endOffset,
      quotedText: selectedText,
      anchorX: Math.max(rangeRect.left, 16),
      anchorY: Math.max(rangeRect.top - 12, 16),
    });
  };

  useEffect(
    () =>
      editor.registerRootListener((rootElement, previousRootElement) => {
        if (previousRootElement) {
          previousRootElement.removeEventListener('mouseup', handleSelectionCapture);
          previousRootElement.removeEventListener('keyup', handleSelectionCapture);
        }

        if (!rootElement) {
          return;
        }

        rootElement.addEventListener('mouseup', handleSelectionCapture);
        rootElement.addEventListener('keyup', handleSelectionCapture);
      }),
    [editor, onRangeSelected, onSelectionCleared, taskId],
  );

  return null;
}

function FormattingToolbar() {
  const [editor] = useLexicalComposerContext();

  return (
    <Stack
      direction="row"
      spacing={0.4}
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        borderBottom: '1px solid var(--sp-control-border)',
        bgcolor: 'var(--sp-control-bg)',
        py: 0.5,
        px: 0.5,
      }}
    >
      <IconButton
        size="small"
        aria-label="Bold"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          editor.focus();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
        }}
      >
        <Icon icon="mdi:format-bold" width={16} height={16} />
      </IconButton>
      <IconButton
        size="small"
        aria-label="Italic"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          editor.focus();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
        }}
      >
        <Icon icon="mdi:format-italic" width={16} height={16} />
      </IconButton>
      <IconButton
        size="small"
        aria-label="Underline"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          editor.focus();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline');
        }}
      >
        <Icon icon="mdi:format-underline" width={16} height={16} />
      </IconButton>
      <IconButton
        size="small"
        aria-label="Bullet List"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          editor.focus();
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        }}
      >
        <Icon icon="mdi:format-list-bulleted" width={16} height={16} />
      </IconButton>
    </Stack>
  );
}

function CommentHighlightsOverlay({
  highlights,
  activeHighlightId,
  onMarkerEnter,
  onMarkerLeave,
  onRemoveRevision,
}: {
  highlights: HighlightVisual[];
  activeHighlightId: string | null;
  onMarkerEnter: (highlightId: string) => void;
  onMarkerLeave: () => void;
  onRemoveRevision?: (input: { revisionId: string; pending: boolean }) => void;
}) {
  if (highlights.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9,
      }}
    >
      {highlights.map((highlight) => (
        <Box key={highlight.id}>
          {highlight.rects.map((rect, index) => (
            <Box
              key={`${highlight.id}-${index}`}
              sx={{
                position: 'absolute',
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                borderRadius: '3px',
                bgcolor: highlight.pending
                  ? 'rgba(102, 172, 255, 0.16)'
                  : 'rgba(255, 214, 102, 0.18)',
                boxShadow:
                  highlight.id === activeHighlightId
                    ? highlight.pending
                      ? 'inset 0 0 0 1px rgba(102, 172, 255, 0.32)'
                      : 'inset 0 0 0 1px rgba(216, 168, 0, 0.35)'
                    : 'none',
                transition: 'box-shadow 160ms ease',
              }}
            />
          ))}
          <Box
            sx={{
              position: 'absolute',
              left: highlight.markerLeft,
              top: highlight.markerTop,
              transform: 'translateX(-50%)',
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: activeHighlightId === highlight.id ? 14 : 8,
              height: 14,
              borderRadius: activeHighlightId === highlight.id ? '2px' : 999,
              color:
                activeHighlightId === highlight.id
                  ? '#ffffff'
                  : highlight.pending
                    ? 'rgba(102, 172, 255, 0.95)'
                    : 'rgba(216, 168, 0, 0.95)',
              bgcolor:
                activeHighlightId === highlight.id
                  ? highlight.pending
                    ? 'rgba(102, 172, 255, 0.95)'
                    : 'rgba(216, 168, 0, 0.95)'
                  : 'transparent',
              backgroundImage:
                activeHighlightId === highlight.id
                  ? 'none'
                  : `linear-gradient(to right, transparent 0, transparent calc(50% - 1px), ${highlight.pending ? 'rgba(102, 172, 255, 0.95)' : 'rgba(216, 168, 0, 0.95)'} calc(50% - 1px), ${highlight.pending ? 'rgba(102, 172, 255, 0.95)' : 'rgba(216, 168, 0, 0.95)'} calc(50% + 1px), transparent calc(50% + 1px), transparent 100%)`,
              fontSize: activeHighlightId === highlight.id ? 9 : 0,
              fontWeight: 700,
              lineHeight: 1,
              cursor: 'pointer',
              transition:
                'width 180ms ease, border-radius 180ms ease, background-color 180ms ease, color 180ms ease, font-size 140ms ease',
              userSelect: 'none',
            }}
            onMouseEnter={() => onMarkerEnter(highlight.id)}
            onMouseLeave={onMarkerLeave}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemoveRevision?.({ revisionId: highlight.id, pending: highlight.pending });
            }}
          >
            ×
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export function LexicalCommentableEditor({
  taskId,
  value,
  height,
  comments,
  pendingDraft,
  onValueChange,
  onRangeSelected,
  onSelectionCleared,
  onRemoveRevision,
}: LexicalCommentableEditorProps) {
  const initialValueRef = useRef(value);
  const lastPlainTextRef = useRef(value);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [highlightVisuals, setHighlightVisuals] = useState<HighlightVisual[]>([]);
  const [hoveredHighlightId, setHoveredHighlightId] = useState<string | null>(null);
  const [markerHoveredHighlightId, setMarkerHoveredHighlightId] = useState<string | null>(null);

  const initialConfig = useMemo(
    () => ({
      namespace: `loan-memo-editor-${taskId}`,
      theme: {},
      onError: (error: Error) => {
        throw error;
      },
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
      editorState: () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(initialValueRef.current));
        root.append(paragraph);
      },
    }),
    [taskId],
  );

  useEffect(() => {
    const recompute = () => {
      const surfaceElement = surfaceRef.current;
      if (!surfaceElement) {
        setHighlightVisuals([]);
        return;
      }

      const rootElement = surfaceElement.querySelector<HTMLElement>('.memo-editor-input');
      if (!rootElement) {
        setHighlightVisuals([]);
        return;
      }

      const surfaceRect = surfaceElement.getBoundingClientRect();
      const nextHighlights: HighlightVisual[] = [];
      const allHighlights = [
        ...comments.map((comment) => ({
          id: comment.id,
          startOffset: comment.startOffset,
          endOffset: comment.endOffset,
          comment: comment.comment,
          pending: false,
        })),
        ...(pendingDraft
          ? [
              {
                id: `${taskId}-pending`,
                startOffset: pendingDraft.startOffset,
                endOffset: pendingDraft.endOffset,
                comment: '',
                pending: true,
              },
            ]
          : []),
      ];

      for (const highlight of allHighlights) {
        const range = getRangeForOffsets(rootElement, highlight.startOffset, highlight.endOffset);
        if (!range) {
          continue;
        }

        const rects = Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({
            left: rect.left - surfaceRect.left,
            top: rect.top - surfaceRect.top,
            width: rect.width,
            height: rect.height,
          }));

        if (rects.length === 0) {
          continue;
        }

        const lastRect = rects[rects.length - 1];
        const markerLeft = lastRect.left + lastRect.width + 2;
        const markerTop = lastRect.top + Math.max(0, lastRect.height - 14);
        nextHighlights.push({
          id: highlight.id,
          startOffset: highlight.startOffset,
          endOffset: highlight.endOffset,
          rects,
          markerLeft,
          markerTop,
          tooltipClientLeft: surfaceRect.left + markerLeft,
          tooltipClientTop: surfaceRect.top + markerTop,
          comment: highlight.comment,
          pending: highlight.pending,
        });
      }

      setHighlightVisuals(nextHighlights);
    };

    recompute();
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('resize', recompute);
    };
  }, [comments, pendingDraft, taskId, value]);

  useEffect(() => {
    const surfaceElement = surfaceRef.current;
    const rootElement = surfaceElement?.querySelector<HTMLElement>('.memo-editor-input');
    if (!rootElement) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const offset = getTextOffsetFromPoint(rootElement, event.clientX, event.clientY);
      if (offset === null) {
        setHoveredHighlightId(null);
        return;
      }

      const hovered = highlightVisuals.find(
        (highlight) => offset >= highlight.startOffset && offset < highlight.endOffset,
      );
      const nextId = hovered?.id ?? null;
      setHoveredHighlightId((current) => (current === nextId ? current : nextId));
    };

    const handleMouseLeave = () => {
      setHoveredHighlightId(null);
    };

    rootElement.addEventListener('mousemove', handleMouseMove);
    rootElement.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      rootElement.removeEventListener('mousemove', handleMouseMove);
      rootElement.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [highlightVisuals]);

  const activeHighlightId = markerHoveredHighlightId ?? hoveredHighlightId;
  const activeHighlight = highlightVisuals.find((highlight) => highlight.id === activeHighlightId) ?? null;

  return (
    <Box
      sx={{
        minHeight: 120,
        ...(height !== undefined ? { height } : null),
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--sp-control-border)',
        borderRadius: 1,
        bgcolor: 'var(--sp-control-bg)',
        overflow: 'hidden',
        '.memo-editor-input': {
          minHeight: 102,
          ...(height !== undefined
            ? {
                height: '100%',
                overflowY: 'auto',
              }
            : { height: 'auto' }),
          outline: 'none',
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--sp-text)',
          px: 1,
          py: 0.8,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        },
        '.memo-editor-placeholder': {
          fontSize: 13,
          color: 'var(--sp-muted-text)',
          px: 1,
          py: 0.8,
          position: 'absolute',
          pointerEvents: 'none',
        },
      }}
    >
      <LexicalComposer initialConfig={initialConfig}>
        <FormattingToolbar />
        <Box
          ref={surfaceRef}
          sx={{
            position: 'relative',
            ...(height !== undefined ? { flex: 1, minHeight: 0 } : null),
          }}
        >
          <RichTextPlugin
            contentEditable={<ContentEditable className="memo-editor-input" />}
            placeholder={<Box className="memo-editor-placeholder">Write revisions and comments...</Box>}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <CommentHighlightsOverlay
            highlights={highlightVisuals}
            activeHighlightId={activeHighlightId}
            onMarkerEnter={setMarkerHoveredHighlightId}
            onMarkerLeave={() => setMarkerHoveredHighlightId(null)}
            onRemoveRevision={onRemoveRevision}
          />
        </Box>
        {activeHighlight ? (
          <Paper
            sx={{
              position: 'fixed',
              left: activeHighlight.tooltipClientLeft,
              top: activeHighlight.tooltipClientTop,
              transform: 'translate(-50%, calc(-100% - 10px))',
              minWidth: 200,
              maxWidth: 320,
              px: 1,
              py: 0.75,
              borderColor: activeHighlight.pending
                ? 'var(--sp-active-blue)'
                : 'rgba(216, 168, 0, 0.65)',
              bgcolor: 'var(--sp-panel-bg)',
              zIndex: 4000,
              pointerEvents: 'none',
            }}
          >
            <Typography sx={{ fontSize: 11, lineHeight: 1.35 }}>
              {activeHighlight.comment ||
                (activeHighlight.pending ? 'New revision comment' : 'Revision comment')}
            </Typography>
          </Paper>
        ) : null}
        <HistoryPlugin />
        <ListPlugin />
        <ExternalTextSyncPlugin value={value} />
        <OnChangePlugin
          onChange={(editorState) => {
            editorState.read(() => {
              const plainText = $getRoot().getTextContent();
              if (plainText === lastPlainTextRef.current) {
                return;
              }
              lastPlainTextRef.current = plainText;
              onValueChange(plainText);
            });
          }}
        />
        <SelectionCapturePlugin
          taskId={taskId}
          onRangeSelected={onRangeSelected}
          onSelectionCleared={onSelectionCleared}
        />
      </LexicalComposer>
    </Box>
  );
}
