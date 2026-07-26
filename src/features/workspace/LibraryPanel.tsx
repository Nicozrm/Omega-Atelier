import { useUIStore } from '@/store/useUIStore'
import { SegmentedControl } from '@/ui'
import { DeviceLibrary } from '@/components/library/DeviceLibrary'
import { FurnitureLibrary } from '@/components/library/FurnitureLibrary'

/**
 * LibraryPanel — the left-rail content: a segmented switch between the
 * device and furniture catalogues, with the active catalogue filling the
 * remaining height.
 */
export function LibraryPanel() {
  const libraryTab = useUIStore((s) => s.libraryTab)
  const setLibraryTab = useUIStore((s) => s.setLibraryTab)

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-2.5">
        <SegmentedControl
          block
          size="sm"
          value={libraryTab === 'templates' ? 'devices' : libraryTab}
          onChange={(v) => setLibraryTab(v)}
          options={[
            { value: 'devices', label: 'Geräte' },
            { value: 'furniture', label: 'Möbel' },
          ]}
        />
      </div>
      <div className="flex-1 overflow-hidden">
        {libraryTab === 'furniture' ? <FurnitureLibrary /> : <DeviceLibrary />}
      </div>
    </div>
  )
}
