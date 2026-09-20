import React from 'react';
import { Link } from 'react-router-dom';
import type { Anomaly } from '../../types';
import { useInvocation } from '../../data/hooks';
import { SeverityBadge } from '../ui/SeverityBadge';
import { RelativeTime } from '../ui/RelativeTime';
import { getFlaggedNetwork } from '../../lib/format';

export interface AnomalyCardProps {
  anomaly: Anomaly;
  isPopIn?: boolean;
}

export const AnomalyCard: React.FC<AnomalyCardProps> = ({ anomaly, isPopIn = false }) => {
  const invocation = useInvocation(anomaly.invocationId);
  const flaggedNetwork = getFlaggedNetwork(invocation);

  const isCritical = anomaly.severity === 'critical';
  const isWarning = anomaly.severity === 'warning';

  let borderClasses = 'border-border-default bg-surface hover:border-border-highlight';
  let stripeColor = 'bg-severity-info';

  if (isCritical) {
    borderClasses =
      'border-severity-critical/60 bg-severity-critical-bg/15 shadow-[0_0_15px_rgba(255,31,75,0.18)] hover:border-severity-critical ring-1 ring-severity-critical/30';
    stripeColor = 'bg-severity-critical';
  } else if (isWarning) {
    borderClasses = 'border-severity-warning-border/70 bg-surface hover:border-severity-warning-border';
    stripeColor = 'bg-severity-warning';
  }

  const kindFormatted = (anomaly.kind || 'UNKNOWN').replace(/_/g, ' ').toUpperCase();

  return (
    <article
      tabIndex={0}
      className={`relative rounded-[3px] border transition-all text-xs font-mono overflow-hidden focus:outline-none focus:ring-2 focus:ring-accent ${borderClasses} ${
        isPopIn ? 'animate-slide-in-top animate-pulse motion-reduce:animate-none' : ''
      }`}
      aria-label={`${anomaly.severity} anomaly: ${anomaly.summary}`}
    >
      {/* Left Severity Stripe */}
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${stripeColor}`} />

      <div className="p-4 pl-5 space-y-3">
        {/* Header: Badges, Kind, Timestamp & Function Name */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={anomaly.severity} size="sm">
              {anomaly.severity.toUpperCase()}
            </SeverityBadge>

            <span className="text-[11px] font-bold text-muted tracking-wider uppercase">
              // {kindFormatted}
            </span>
          </div>

          <div className="flex items-center gap-2 text-muted text-[11px]">
            <span
              className="px-1.5 py-0.5 rounded-[2px] bg-raised border border-border-subtle text-primary font-bold truncate max-w-[180px]"
              title={anomaly.functionName}
            >
              {anomaly.functionName}
            </span>
            <span className="text-border-highlight">•</span>
            <RelativeTime timestamp={anomaly.timestamp} />
          </div>
        </div>

        {/* Headline / Summary */}
        <h3
          className={`font-sans font-bold text-sm leading-snug tracking-tight ${
            isCritical ? 'text-white' : 'text-primary'
          }`}
        >
          {anomaly.summary}
        </h3>

        {/* Flagged Network Connections (Looked up from Invocation) */}
        {flaggedNetwork.length > 0 && (
          <div className="p-2 rounded-[2px] bg-severity-critical-bg/30 border border-severity-critical/40 space-y-1">
            <div className="text-[10px] font-bold uppercase text-severity-critical flex items-center gap-1.5">
              <span>⚠ FLAGGED NETWORK EGRESS:</span>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              {flaggedNetwork.map((net, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 rounded-[2px] bg-base text-severity-critical border border-severity-critical/50 font-bold truncate max-w-[300px]"
                  title={`${net.protocol.toUpperCase()} ${net.host}:${net.port}`}
                >
                  {net.host}:{net.port} ({Math.round(net.bytesSent / 1024)} KB sent)
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Bedrock AI Analysis Block */}
        {anomaly.explanation && (
          <div className="p-3 rounded-[2px] bg-base/80 border border-border-default space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-accent">
              <svg
                className="w-3.5 h-3.5 text-accent shrink-0"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
              </svg>
              <span>AI ANALYSIS</span>
            </div>
            <p className="font-sans text-secondary text-xs leading-relaxed max-w-4xl break-words">
              {anomaly.explanation}
            </p>
          </div>
        )}

        {/* Footer Link */}
        <div className="flex items-center justify-between pt-1 border-t border-border-subtle/70 text-[11px]">
          <span className="text-muted text-[10px] font-mono">
            TRACE: {anomaly.invocationId}
          </span>
          <Link
            to={`/invocation/${anomaly.invocationId}`}
            className="inline-flex items-center gap-1 font-bold text-accent hover:text-accent-hover transition-colors group cursor-pointer"
          >
            <span>View invocation trace</span>
            <span className="group-hover:translate-x-0.5 transition-transform">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
};
