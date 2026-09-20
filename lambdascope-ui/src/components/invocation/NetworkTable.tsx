import React from 'react';
import type { NetworkConnection } from '../../types';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { SeverityBadge } from '../ui/SeverityBadge';
import { formatBytes } from '../../lib/format';

export interface NetworkTableProps {
  network?: NetworkConnection[];
}

function getHostTag(host: string): string | null {
  const lower = host.toLowerCase();
  if (lower.includes('169.254.169.254')) return 'AWS IMDS';
  if (lower.includes('dynamodb')) return 'AWS DynamoDB';
  if (lower.includes('stripe')) return 'Stripe API';
  if (lower.includes('amazonaws.com')) return 'AWS Service';
  return null;
}

export const NetworkTable: React.FC<NetworkTableProps> = ({ network }) => {
  if (!network || network.length === 0) {
    return (
      <Card
        title="Outbound Network Sockets"
        subtitle="Network connections established during invocation"
      >
        <EmptyState
          title="No Outbound Network Activity"
          description="This invocation made no outbound TCP or UDP network requests."
        />
      </Card>
    );
  }

  return (
    <Card
      title="Outbound Network Sockets"
      subtitle={`${network.length} destination endpoints recorded via socket tracking`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-xs border-collapse">
          <thead>
            <tr className="border-b border-border-default text-[11px] text-muted uppercase tracking-wider">
              <th className="py-2 px-2.5 font-semibold">Destination Host</th>
              <th className="py-2 px-2.5 font-semibold">Port</th>
              <th className="py-2 px-2.5 font-semibold">Proto</th>
              <th className="py-2 px-2.5 font-semibold text-right">Sent</th>
              <th className="py-2 px-2.5 font-semibold text-right">Recv</th>
              <th className="py-2 px-2.5 font-semibold text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/50">
            {network.map((conn, idx) => {
              const hostTag = getHostTag(conn.host);
              const isFlagged = conn.flagged;

              return (
                <React.Fragment key={`${conn.host}-${conn.port}-${idx}`}>
                  <tr
                    className={`transition-colors ${
                      isFlagged
                        ? 'bg-severity-critical-bg/25 hover:bg-severity-critical-bg/35 border-l-2 border-l-severity-critical'
                        : 'hover:bg-surface/60'
                    }`}
                  >
                    {/* Destination Host */}
                    <td className="py-2.5 px-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`font-semibold max-w-[220px] sm:max-w-xs truncate ${
                            isFlagged ? 'text-severity-critical' : 'text-primary'
                          }`}
                          title={conn.host}
                        >
                          {conn.host}
                        </span>
                        {hostTag && !isFlagged && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-surface border border-border-subtle text-muted uppercase font-sans">
                            {hostTag}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Port */}
                    <td className="py-2.5 px-2.5 text-secondary tabular-nums">
                      :{conn.port}
                    </td>

                    {/* Protocol */}
                    <td className="py-2.5 px-2.5 uppercase text-muted text-[11px]">
                      {conn.protocol || 'TCP'}
                    </td>

                    {/* Sent */}
                    <td className="py-2.5 px-2.5 text-right text-secondary tabular-nums">
                      {formatBytes(conn.bytesSent)}
                    </td>

                    {/* Recv */}
                    <td className="py-2.5 px-2.5 text-right text-secondary tabular-nums">
                      {formatBytes(conn.bytesRecv)}
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-2.5 text-right">
                      {isFlagged ? (
                        <SeverityBadge severity="critical" size="sm">
                          FLAGGED
                        </SeverityBadge>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <span>ALLOWLIST</span>
                        </span>
                      )}
                    </td>
                  </tr>

                  {/* Warning Note Row for Flagged Hosts */}
                  {isFlagged && (
                    <tr className="bg-severity-critical-bg/15 border-l-2 border-l-severity-critical">
                      <td colSpan={6} className="py-1 px-2.5 pb-2 text-[11px] text-severity-critical font-sans">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-severity-critical">&gt;&gt;</span>
                          <span>Not in this function&apos;s normal traffic. Egress to unauthorized host detected.</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
