import React from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, GlobalStyles, ThemeProvider, createTheme } from '@mui/material';
import '@xyflow/react/dist/style.css';

import { App } from './App';

const palette = {
  text: '#f8f9fa',
  bottomBg: '#1E252B',
  selectedBg: '#3A4853',
  raisedBg: '#2B343C',
  panelBg: '#242D34',
  chromeBg: '#20272E',
  railBg: '#212930',
  surfaceBg: '#1B2228',
  border: '#3B4650',
  controlBg: '#212930',
  controlBorder: '#7A848D',
  controlHover: '#29323A',
  activeBlue: '#66ACFF',
  activeGreen: '#73C84C',
  logoTeal: '#13A0B1',
  logoOrange: '#FA481C',
  mutedText: '#A2AFB7',
  activityGrey: '#313233',
};

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: palette.activeBlue,
    },
    secondary: {
      main: palette.logoTeal,
    },
    success: {
      main: palette.activeGreen,
    },
    warning: {
      main: palette.logoOrange,
    },
    background: {
      default: palette.bottomBg,
      paper: palette.raisedBg,
    },
    text: {
      primary: palette.text,
      secondary: palette.mutedText,
    },
  },
  shape: {
    borderRadius: 3,
  },
  typography: {
    fontFamily: '"IBM Plex Sans", sans-serif',
    h3: {
      fontFamily: '"Space Grotesk", sans-serif',
      fontWeight: 700,
      letterSpacing: '-0.04em',
    },
    h6: {
      fontFamily: '"Space Grotesk", sans-serif',
      fontWeight: 700,
      letterSpacing: '-0.03em',
    },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: palette.panelBg,
          backgroundImage: 'none',
          border: `1px solid ${palette.border}`,
          boxShadow: 'none',
          borderRadius: 8,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          height: 26,
          fontWeight: 600,
          backgroundColor: palette.controlBg,
          border: `1px solid ${palette.border}`,
        },
        outlined: {
          borderColor: palette.controlBorder,
          backgroundColor: palette.controlBg,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 40,
          paddingInline: 14,
          borderRadius: 4,
          textTransform: 'none',
          boxShadow: 'none',
          fontWeight: 600,
          letterSpacing: '-0.01em',
        },
        outlined: {
          backgroundColor: palette.controlBg,
          borderColor: palette.controlBorder,
          color: palette.text,
        },
        outlinedPrimary: {
          borderColor: palette.controlBorder,
          color: palette.text,
        },
        containedPrimary: {
          backgroundImage: 'none',
          backgroundColor: 'rgba(102, 172, 255, 0.12)',
          color: palette.activeBlue,
          border: `1px solid rgba(102, 172, 255, 0.45)`,
        },
        text: {
          minHeight: 32,
          paddingInline: 8,
        },
        textPrimary: {
          color: palette.activeBlue,
        },
      },
      defaultProps: {
        disableElevation: true,
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          marginTop: 8,
          minWidth: 220,
          backgroundColor: palette.controlBg,
          border: `1px solid ${palette.controlBorder}`,
          boxShadow: 'none',
          borderRadius: 4,
        },
        list: {
          paddingBlock: 4,
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 38,
          borderRadius: 4,
          marginInline: 4,
          paddingInline: 10,
          '&:hover': {
            backgroundColor: palette.controlHover,
          },
        },
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: {
          color: palette.mutedText,
          '&.Mui-checked': {
            color: palette.activeBlue,
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          minHeight: 42,
          borderRadius: 4,
          backgroundColor: palette.controlBg,
          color: palette.text,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: palette.controlBorder,
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: palette.text,
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: palette.activeBlue,
          },
        },
        input: {
          paddingBlock: 10,
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: palette.mutedText,
          '&.Mui-focused': {
            color: palette.activeBlue,
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${palette.border}`,
        },
        head: {
          color: palette.text,
        },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          ':root': {
            '--sp-text': palette.text,
            '--sp-bottom-bg': palette.bottomBg,
            '--sp-selected-bg': palette.selectedBg,
            '--sp-raised-bg': palette.raisedBg,
            '--sp-panel-bg': palette.panelBg,
            '--sp-chrome-bg': palette.chromeBg,
            '--sp-rail-bg': palette.railBg,
            '--sp-surface-bg': palette.surfaceBg,
            '--sp-border': palette.border,
            '--sp-control-bg': palette.controlBg,
            '--sp-control-border': palette.controlBorder,
            '--sp-control-hover': palette.controlHover,
            '--sp-active-blue': palette.activeBlue,
            '--sp-active-green': palette.activeGreen,
            '--sp-logo-teal': palette.logoTeal,
            '--sp-logo-orange': palette.logoOrange,
            '--sp-muted-text': palette.mutedText,
            '--sp-activity-grey': palette.activityGrey,
          },
          body: {
            color: palette.text,
            backgroundColor: palette.bottomBg,
            scrollbarColor: `${palette.selectedBg} ${palette.bottomBg}`,
            fontFeatureSettings: '"ss01" on, "cv02" on',
          },
          '*': {
            boxSizing: 'border-box',
            scrollbarWidth: 'thin',
            scrollbarColor: `${palette.selectedBg} ${palette.bottomBg}`,
          },
          '*::-webkit-scrollbar': {
            width: '12px',
            height: '12px',
          },
          '*::-webkit-scrollbar-track': {
            backgroundColor: palette.bottomBg,
          },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: palette.selectedBg,
            borderRadius: '10px',
            border: `2px solid ${palette.bottomBg}`,
          },
          '*::-webkit-scrollbar-thumb:hover': {
            backgroundColor: palette.logoTeal,
          },
          '*::-webkit-scrollbar-corner': {
            backgroundColor: palette.bottomBg,
          },
          '#root': {
            minHeight: '100vh',
            backgroundColor: palette.bottomBg,
          },
          '.react-flow': {
            background: 'transparent',
          },
          '.react-flow__controls': {
            border: `1px solid ${palette.controlBorder}`,
            borderRadius: '4px',
            overflow: 'hidden',
            boxShadow: 'none',
          },
          '.react-flow__controls-button': {
            backgroundColor: palette.controlBg,
            color: palette.text,
            borderBottom: `1px solid ${palette.border}`,
          },
          '.react-flow__controls-button:hover': {
            backgroundColor: palette.controlHover,
          },
          '.react-flow__minimap': {
            backgroundColor: palette.controlBg,
            border: `1px solid ${palette.border}`,
            borderRadius: '4px',
          },
          '.react-flow__node': {
            backgroundColor: palette.controlBg,
            color: palette.text,
            border: `1px solid ${palette.border}`,
            borderRadius: '8px',
            boxShadow: 'none',
            fontFamily: '"IBM Plex Sans", sans-serif',
          },
          '.react-flow__node.selectable.selected': {
            borderColor: palette.activeBlue,
            boxShadow: '0 0 0 1px rgba(102, 172, 255, 0.24)',
          },
          '.react-flow__edge-path': {
            stroke: palette.mutedText,
            strokeWidth: 2,
          },
          '.react-flow__edge.selected .react-flow__edge-path': {
            stroke: palette.activeBlue,
          },
          '.react-flow__edgeupdater': {
            opacity: 0,
            fill: palette.panelBg,
            stroke: palette.activeBlue,
            strokeWidth: 2,
            transition: 'opacity 120ms ease',
            pointerEvents: 'all',
            cursor: 'crosshair',
          },
          '.react-flow__handle': {
            width: '9px',
            height: '9px',
            border: `1px solid ${palette.text}`,
            backgroundColor: palette.activeBlue,
          },
          '.sp-node-handle': {
            width: '18px !important',
            height: '18px !important',
            borderRadius: '999px !important',
            border: `1px solid rgba(102, 172, 255, 0.45) !important`,
            backgroundColor: `${palette.activeBlue} !important`,
            boxShadow: '0 0 0 4px rgba(102, 172, 255, 0.08)',
            color: '#081018',
          },
          '.sp-node-handle::after': {
            content: '"+"',
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            fontSize: '14px',
            fontWeight: 700,
            lineHeight: 1,
          },
          '.sp-node-handle-connecting': {
            opacity: 1,
          },
        }}
      />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
