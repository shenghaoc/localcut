import { For, Show } from 'solid-js';
import { CheckCircle2, CircleAlert, X } from 'lucide-solid';
import type { CapabilityFeatureInfo, CapabilityTier } from './capabilities';
import { Button } from './components/button';

interface CapabilityPanelProps {
  open: boolean;
  tier: CapabilityTier;
  features: CapabilityFeatureInfo[];
  primaryIssue: string | null;
  compatibilityPreviewAvailable: boolean;
  onClose: () => void;
}

function tierLabel(tier: CapabilityTier): string {
  switch (tier) {
    case 'accelerated':
      return 'Accelerated';
    case 'limited':
      return 'Limited shell';
    case 'starting':
      return 'Starting pipeline';
    case 'blocked':
      return 'Blocked';
  }
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
      >
        <header class="capability-panel-header">
          <div>
            <p class="panel-title" id="capability-panel-title">
              Browser capabilities
            </p>
            <p class="capability-panel-tier">Active tier: {tierLabel(props.tier)}</p>
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
            Compatibility preview is available: import shows a reduced thumbnail only. Timeline,
            transport, effects, and export remain disabled until the accelerated tier is active.
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
      </aside>
    </Show>
  );
}
