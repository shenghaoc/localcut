import { For, Show } from 'solid-js';
import { CheckCircle2, CircleAlert, X } from 'lucide-solid';
import type { CapabilityFeatureInfo, CapabilityTier } from './capabilities';
import type { CapabilityProbeResult } from '../protocol';
import { Button } from './components/button';
import { CapabilityMatrixPanel } from './CapabilityMatrixPanel';

interface CapabilityPanelProps {
  open: boolean;
  tier: CapabilityTier;
  tierLabel: string;
  features: CapabilityFeatureInfo[];
  primaryIssue: string | null;
  compatibilityPreviewAvailable: boolean;
  previewReady: boolean;
  exportReady: boolean;
  capabilityProbeV2: CapabilityProbeResult | null;
  onClose: () => void;
}

export function CapabilityPanel(props: CapabilityPanelProps) {
  return (
    <Show when={props.open}>
      <div class="capability-backdrop" onClick={props.onClose} aria-hidden="true" />
      <aside
        class="capability-panel panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capability-panel-title"
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === 'Escape') props.onClose(); }}
      >
        <header class="capability-panel-header">
          <div>
            <p class="panel-title" id="capability-panel-title">
              Browser capabilities
            </p>
            <p class="capability-panel-tier">Active tier: {props.tierLabel}</p>
          </div>
          <Button size="icon" variant="ghost" onClick={props.onClose} aria-label="Close capability panel">
            <X size={16} aria-hidden="true" />
          </Button>
        </header>

        <Show when={props.primaryIssue}>
          <p class="capability-panel-issue">{props.primaryIssue}</p>
        </Show>

        <Show when={props.compatibilityPreviewAvailable && props.tier === 'limited'}>
          <p class="capability-panel-note">
            {props.previewReady
              ? `Reduced preview${props.exportReady ? ' and export are' : ' is'} available in this browser tier. Advanced GPU effects remain limited.`
              : 'Compatibility import can still show a reduced thumbnail for inspection, but timeline preview and export are unavailable.'}
          </p>
        </Show>

        <ul class="capability-list">
          <For each={props.features}>
            {(feature) => (
              <li class={`capability-item ${feature.available ? 'is-ok' : 'is-missing'}`}>
                <div class="capability-item-head">
                  {feature.available ? (
                    <CheckCircle2 size={15} aria-hidden="true" />
                  ) : (
                    <CircleAlert size={15} aria-hidden="true" />
                  )}
                  <span>{feature.label}</span>
                </div>
                <p>{feature.detail}</p>
                <Show when={feature.action !== null}>
                  <p class="capability-item-action">{feature.action}</p>
                </Show>
              </li>
            )}
          </For>
        </ul>

        <CapabilityMatrixPanel probe={props.capabilityProbeV2} />
      </aside>
    </Show>
  );
}
