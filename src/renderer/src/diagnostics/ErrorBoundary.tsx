import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  info: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ hasError: true, error, info });
    // Aquí podrías loguear el error a un servicio externo
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, color: '#b00', background: '#fff', fontFamily: 'monospace' }}>
          <h2>¡Ocurrió un error inesperado en la aplicación!</h2>
          <pre>{this.state.error?.toString()}</pre>
          {this.state.info && <details style={{ whiteSpace: 'pre-wrap' }}>{this.state.info.componentStack}</details>}
          <p>Por favor, recarga la app o contacta soporte si el problema persiste.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
