/**
 * OMEGA UI — reusable, strictly-typed, theme-aware primitives.
 * No business logic lives here; compose these in /features and /components.
 */
export { Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'

export { IconButton } from './IconButton'
export type { IconButtonProps, IconButtonVariant, IconButtonSize } from './IconButton'

export { Panel, PanelHeader } from './Panel'
export type { PanelProps, PanelHeaderProps, PanelVariant } from './Panel'

export { Card } from './Card'
export type { CardProps } from './Card'

export { Badge } from './Badge'
export type { BadgeProps, BadgeTone } from './Badge'

export { Divider } from './Divider'
export type { DividerProps } from './Divider'

export { SegmentedControl } from './SegmentedControl'
export type { SegmentedControlProps, SegmentOption } from './SegmentedControl'

export { InspectorSection, InspectorRow } from './InspectorSection'
export type { InspectorSectionProps } from './InspectorSection'

export { Tooltip } from './Tooltip'
export type { TooltipProps } from './Tooltip'

export { Toolbar, ToolbarGroup } from './Toolbar'

export { Dialog } from './Dialog'
export type { DialogProps } from './Dialog'

export { useModalA11y } from './useModalA11y'
export type { ModalA11yOptions } from './useModalA11y'
