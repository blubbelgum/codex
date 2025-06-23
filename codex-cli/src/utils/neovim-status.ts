/**
 * Utility for checking global Neovim connection status
 */

interface NeovimConnectionStatus {
  connected: boolean;
  socket?: string;
  host?: string;
  port?: number;
}

/**
 * Get the current Neovim connection status
 */
export async function getNeovimConnectionStatus(): Promise<NeovimConnectionStatus> {
  try {
    // Dynamic import to avoid circular dependencies
    const { globalNeovimConnection } = await import('./agent/handle-exec-command.js');
    
    if (globalNeovimConnection && globalNeovimConnection.isConnected()) {
      const connectionInfo = globalNeovimConnection.getConnectionInfo();
      return {
        connected: true,
        socket: connectionInfo.socket,
        host: connectionInfo.host,
        port: connectionInfo.port
      };
    }
  } catch (error) {
    // If import fails or other error, assume not connected
  }
  
  return { connected: false };
}

/**
 * Format the Neovim connection status for display
 */
export function formatNeovimStatus(status: NeovimConnectionStatus): string {
  if (status.connected) {
    const connectionString = status.socket || `${status.host}:${status.port}`;
    return `Neovim: Connected (${connectionString})`;
  }
  return 'Neovim: Not connected';
} 