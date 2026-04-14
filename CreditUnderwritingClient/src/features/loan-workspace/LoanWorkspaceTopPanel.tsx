import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';

import { LoanStatusVisualizerPanel, type LoanStatusGraph } from '../loan-status-visualizer';

export type WorkspaceTopTab = 'flow' | 'package';

export type PublicPdfDocument = {
  id: string;
  name: string;
  url: string;
};

type LoanWorkspaceTopPanelProps = {
  loanName: string;
  topTab: WorkspaceTopTab;
  onTopTabChange: (nextTab: WorkspaceTopTab) => void;
  loanStatusGraph: LoanStatusGraph | null;
  loanFlowLoading: boolean;
  loanFlowError: string | null;
  flowRecenterSignal: number;
  onFlowRecenter: () => void;
  publicPdfDocuments: PublicPdfDocument[];
  selectedPublicPdfUrl: string;
  onSelectedPublicPdfUrlChange: (url: string) => void;
  topPanelPercent: number;
};

export function LoanWorkspaceTopPanel({
  loanName,
  topTab,
  onTopTabChange,
  loanStatusGraph,
  loanFlowLoading,
  loanFlowError,
  flowRecenterSignal,
  onFlowRecenter,
  publicPdfDocuments,
  selectedPublicPdfUrl,
  onSelectedPublicPdfUrlChange,
  topPanelPercent,
}: LoanWorkspaceTopPanelProps) {
  const [flowContextMenuPosition, setFlowContextMenuPosition] = useState<{
    mouseX: number;
    mouseY: number;
  } | null>(null);

  const selectedPublicPdf =
    useMemo(
      () =>
        publicPdfDocuments.find((pdf) => pdf.url === selectedPublicPdfUrl) ??
        publicPdfDocuments[0] ??
        null,
      [publicPdfDocuments, selectedPublicPdfUrl],
    );

  return (
    <>
      <Paper
        sx={{
          p: 0,
          overflow: 'hidden',
          minHeight: 0,
          flex: `0 0 ${topPanelPercent}%`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ px: 1.5, pt: 1.5, borderBottom: '1px solid var(--sp-border)' }}>
          <Typography variant="h4" sx={{ mb: 0.25 }}>
            {loanName}
          </Typography>

          <Tabs
            value={topTab}
            onChange={(_event, value: WorkspaceTopTab) => onTopTabChange(value)}
            textColor="inherit"
            indicatorColor="primary"
            sx={{ minHeight: 38, '& .MuiTab-root': { minHeight: 38, textTransform: 'none' } }}
          >
            <Tab value="flow" label="Loan Status" />
            <Tab value="package" label="Doc Package Viewer" />
          </Tabs>
        </Box>

        <Box
          sx={{
            p: 1.5,
            flex: 1,
            minHeight: 0,
            overflow: topTab === 'flow' ? 'hidden' : 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {topTab === 'flow' ? (
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                width: '100%',
                display: 'flex',
                overflow: 'hidden',
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setFlowContextMenuPosition({
                  mouseX: event.clientX + 2,
                  mouseY: event.clientY - 6,
                });
              }}
            >
              <LoanStatusVisualizerPanel
                graph={loanStatusGraph}
                loading={loanFlowLoading}
                error={loanFlowError}
                recenterSignal={flowRecenterSignal}
              />
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 1.5,
                gridTemplateColumns: { xs: '1fr', lg: '320px minmax(0, 1fr)' },
                height: '100%',
                minHeight: 0,
              }}
            >
              <Paper
                sx={{
                  p: 1.5,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <Stack spacing={0.75} sx={{ overflow: 'auto', pr: 0.5 }}>
                  {publicPdfDocuments.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No sample PDFs found.
                    </Typography>
                  ) : (
                    publicPdfDocuments.map((document) => {
                      const isSelected = selectedPublicPdf?.id === document.id;
                      return (
                        <Button
                          key={document.id}
                          variant={isSelected ? 'contained' : 'outlined'}
                          color={isSelected ? 'primary' : 'inherit'}
                          onClick={() => onSelectedPublicPdfUrlChange(document.url)}
                          sx={{
                            justifyContent: 'flex-start',
                            textTransform: 'none',
                            py: 0.8,
                            px: 1,
                          }}
                        >
                          <Icon icon="mdi:file-pdf-box" width={16} height={16} />
                          <Box
                            component="span"
                            sx={{
                              ml: 0.75,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              textAlign: 'left',
                            }}
                          >
                            {document.name}
                          </Box>
                        </Button>
                      );
                    })
                  )}
                </Stack>
              </Paper>

              <Paper
                sx={{
                  p: 0,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                {selectedPublicPdf ? (
                  <Box
                    key={selectedPublicPdf.url}
                    component="iframe"
                    src={selectedPublicPdf.url}
                    title={selectedPublicPdf.name}
                    sx={{
                      width: '100%',
                      flex: 1,
                      minHeight: 0,
                      border: 0,
                      borderRadius: 0,
                      backgroundColor: '#fff',
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      border: '1px dashed var(--sp-control-border)',
                      borderRadius: 1,
                      display: 'grid',
                      placeItems: 'center',
                      color: 'var(--sp-muted-text)',
                      px: 2,
                      textAlign: 'center',
                    }}
                  >
                    <Typography variant="body2">No PDF selected.</Typography>
                  </Box>
                )}
              </Paper>
            </Box>
          )}
        </Box>
      </Paper>

      <Menu
        open={flowContextMenuPosition !== null}
        onClose={() => setFlowContextMenuPosition(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          flowContextMenuPosition !== null
            ? { top: flowContextMenuPosition.mouseY, left: flowContextMenuPosition.mouseX }
            : undefined
        }
      >
        <MenuItem
          onClick={() => {
            setFlowContextMenuPosition(null);
            onFlowRecenter();
          }}
        >
          Recenter &amp; Reset Zoom
        </MenuItem>
      </Menu>
    </>
  );
}
