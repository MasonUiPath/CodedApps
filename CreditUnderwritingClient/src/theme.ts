import { createTheme } from '@mui/material';

export const paletteTokens = {
  text: '#ECF3FF',
  secondaryText: '#B8C7DC',
  bottomBg: '#0E1522',
  selectedBg: '#22324A',
  raisedBg: '#18263B',
  panelBg: '#142033',
  chromeBg: '#142033',
  railBg: '#0F1B2D',
  surfaceBg: '#101C2E',
  border: '#2A3B55',
  controlBg: '#18263B',
  controlBorder: '#2A3B55',
  controlHover: '#22324A',
  activeBlue: '#4EA3FF',
  activeGreen: '#48C774',
  logoTeal: '#3BB2A5',
  logoOrange: '#FA481C',
  statusYellow: '#E7B84A',
  mutedText: '#8FA0B8',
  activityGrey: '#8A98AD',
};

export const appTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: paletteTokens.activeBlue,
    },
    secondary: {
      main: paletteTokens.logoTeal,
    },
    success: {
      main: paletteTokens.activeGreen,
    },
    warning: {
      main: paletteTokens.statusYellow,
    },
    background: {
      default: paletteTokens.bottomBg,
      paper: paletteTokens.raisedBg,
    },
    text: {
      primary: paletteTokens.text,
      secondary: paletteTokens.secondaryText,
    },
  },
  shape: {
    borderRadius: 3,
  },
  typography: {
    fontFamily: '"IBM Plex Sans", sans-serif',
    h4: {
      fontFamily: '"Space Grotesk", sans-serif',
      fontWeight: 700,
      letterSpacing: '-0.03em',
    },
    h5: {
      fontFamily: '"Space Grotesk", sans-serif',
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    h6: {
      fontFamily: '"Space Grotesk", sans-serif',
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    subtitle2: {
      fontSize: '0.78rem',
      fontWeight: 600,
      lineHeight: 1.3,
    },
    body1: {
      fontSize: '0.88rem',
      fontWeight: 500,
      lineHeight: 1.45,
    },
    body2: {
      fontSize: '0.82rem',
      fontWeight: 500,
      lineHeight: 1.45,
    },
    caption: {
      fontSize: '0.74rem',
      fontWeight: 400,
      lineHeight: 1.4,
    },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: paletteTokens.panelBg,
          backgroundImage: 'none',
          border: `1px solid ${paletteTokens.border}`,
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
          backgroundColor: paletteTokens.controlBg,
          border: `1px solid ${paletteTokens.border}`,
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
          backgroundColor: paletteTokens.controlBg,
          borderColor: paletteTokens.controlBorder,
          color: paletteTokens.text,
        },
        containedPrimary: {
          backgroundImage: 'none',
          backgroundColor: 'rgba(102, 172, 255, 0.12)',
          color: paletteTokens.activeBlue,
          border: '1px solid rgba(102, 172, 255, 0.45)',
        },
      },
      defaultProps: {
        disableElevation: true,
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          minHeight: 42,
          borderRadius: 4,
          backgroundColor: paletteTokens.controlBg,
          color: paletteTokens.text,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: paletteTokens.controlBorder,
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: paletteTokens.text,
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: paletteTokens.activeBlue,
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
          color: paletteTokens.mutedText,
          '&.Mui-focused': {
            color: paletteTokens.activeBlue,
          },
        },
        outlined: {
          '&.MuiInputLabel-shrink': {
            backgroundColor: paletteTokens.controlBg,
            borderRadius: 4,
            paddingInline: 6,
          },
        },
      },
    },
  },
});

export const globalStyles = {
  ':root': {
    '--sp-text': paletteTokens.text,
    '--sp-text-secondary': paletteTokens.secondaryText,
    '--sp-bottom-bg': paletteTokens.bottomBg,
    '--sp-selected-bg': paletteTokens.selectedBg,
    '--sp-raised-bg': paletteTokens.raisedBg,
    '--sp-panel-bg': paletteTokens.panelBg,
    '--sp-chrome-bg': paletteTokens.chromeBg,
    '--sp-rail-bg': paletteTokens.railBg,
    '--sp-surface-bg': paletteTokens.surfaceBg,
    '--sp-border': paletteTokens.border,
    '--sp-control-bg': paletteTokens.controlBg,
    '--sp-control-border': paletteTokens.controlBorder,
    '--sp-control-hover': paletteTokens.controlHover,
    '--sp-active-blue': paletteTokens.activeBlue,
    '--sp-active-green': paletteTokens.activeGreen,
    '--sp-logo-teal': paletteTokens.logoTeal,
    '--sp-logo-orange': paletteTokens.logoOrange,
    '--sp-muted-text': paletteTokens.mutedText,
    '--sp-activity-grey': paletteTokens.activityGrey,
  },
  body: {
    color: paletteTokens.text,
    backgroundColor: paletteTokens.bottomBg,
    fontFeatureSettings: '"ss01" on, "cv02" on',
    lineHeight: 1.45,
  },
  '*': {
    boxSizing: 'border-box',
  },
  '#root': {
    minHeight: '100vh',
    backgroundColor: paletteTokens.bottomBg,
  },
};
