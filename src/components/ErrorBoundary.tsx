/**
 * @fileoverview Error Boundary component to catch and display React errors gracefully.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { ErrorBoundaryProps, ErrorBoundaryState } from '../types';

/**
 * Error Boundary component that catches React errors and displays a user-friendly message.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error details for debugging
    console.error('Error Boundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo
    });
  }

  handleReset = (): void => {
    // Reset error state to allow retry
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render(): ReactNode | React.ReactNode {
    if (this.state.hasError) {
      return (
        <Box className="error-boundary-container">
          <Alert severity="error" className="error-boundary-alert">
            <AlertTitle>Something went wrong</AlertTitle>
            <Typography variant="body2" className="error-boundary-message">
              The extension encountered an unexpected error. Please try refreshing the popup.
            </Typography>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <Box className="error-boundary-details">
                <Typography variant="caption" component="div" className="error-boundary-details-title">
                  Error Details (Development Only):
                </Typography>
                <Typography variant="caption" component="div" className="error-boundary-details-error">
                  {this.state.error.toString()}
                </Typography>
                {this.state.errorInfo && (
                  <Typography variant="caption" component="div" className="error-boundary-details-stack">
                    {this.state.errorInfo.componentStack}
                  </Typography>
                )}
              </Box>
            )}
          </Alert>
          <Button
            variant="contained"
            color="primary"
            startIcon={<RefreshIcon />}
            onClick={this.handleReset}
          >
            Try Again
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}
