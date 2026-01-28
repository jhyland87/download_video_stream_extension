/**
 * @fileoverview Material-UI theme configuration for the extension.
 * Centralizes all theme-related settings for consistent styling across components.
 */

import { createTheme, Theme } from '@mui/material/styles';

/**
 * Creates and returns the Material-UI theme for the extension.
 * @returns {Theme} The configured Material-UI theme
 */
export const createAppTheme = (): Theme => {
  return createTheme({
    palette: {
      mode: 'light',
      primary: {
        main: '#1976d2',
      },
      secondary: {
        main: '#555',
      },
      success: {
        main: '#2e7d32',
      },
      error: {
        main: '#d32f2f',
      },
    },
    typography: {
      fontSize: 12,
      h6: {
        fontSize: '16px',
        fontWeight: 600,
      },
      subtitle2: {
        fontSize: '12px',
        fontWeight: 600,
      },
      body2: {
        fontSize: '12px',
      },
      caption: {
        fontSize: '11px',
      },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontSize: '12px',
            padding: '6px 12px',
            borderRadius: '4px',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            borderRadius: '4px',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontSize: '12px',
            height: '28px',
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            borderRadius: '4px',
          },
        },
      },
      MuiSpeedDial: {
        styleOverrides: {
          root: {
            position: 'fixed',
            bottom: 0,
            right: 0,
          },
        },
      },
    },
  });
};

/**
 * Default theme instance for the extension.
 * Use this in ThemeProvider components.
 */
export const appTheme = createAppTheme();
