import { Sparkles, Cpu, Layers3 } from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { InspectorSection } from '@/ui'
import { ModesPanel } from '@/components/modes/ModesPanel'
import { QuickStats } from '@/components/editor/QuickStats'
import { LayerPanel } from '@/components/editor/LayerPanel'
import { PropertyPanel } from '@/components/editor/PropertyPanel'

/**
 * InspectorPanel — the unified right-hand inspector for the editor.
 *
 * Progressive disclosure: the contextual Properties block always sits at
 * the top (it adapts to the current selection / tool on its own). The
 * remaining workspace tools — Omega modes, plan stats and layer
 * visibility — are grouped into collapsible sections so the panel stays
 * calm and only the section you care about needs to be open.
 */
export function InspectorPanel() {
  const selection = usePlanStore((s) => s.selection)
  const hasSelection = !!selection.type && selection.ids.length > 0

  return (
    <div className="flex h-full flex-col overflow-y-auto omega-scroll">
      {/* Contextual properties — self-contained, adapts to selection/tool */}
      <div className="p-3 pb-0">
        <PropertyPanel />
      </div>

      {/* Grouped workspace sections */}
      <div className="mt-3 border-t border-[color:var(--border)]">
        <InspectorSection
          title="Omega-Modi"
          icon={<Sparkles size={13} />}
          defaultOpen={!hasSelection}
        >
          <ModesPanel />
        </InspectorSection>

        <InspectorSection title="Quick Stats" icon={<Cpu size={13} />} defaultOpen={!hasSelection}>
          <QuickStats />
        </InspectorSection>

        <InspectorSection title="Ebenen" icon={<Layers3 size={13} />} defaultOpen={false}>
          <LayerPanel />
        </InspectorSection>
      </div>
    </div>
  )
}
