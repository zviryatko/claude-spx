import type { ClientModule } from 'claude-code'

type Props = { label: string }
type State = { tick: number }

// Claude Code's own spinner glyph cycle and accent colour.
const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const ACCENT = '#d77757'

const Spinner: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.every(120, () => surface.setState({ tick: (surface.state?.tick ?? 0) + 1 }))
    surface.setState({ tick: 0 })
  }
  const tick = surface.state?.tick ?? 0
  const dots = '.'.repeat((Math.floor(tick / 4) % 3) + 1).padEnd(3, ' ')
  return (
    <Box flexDirection="column" alignItems="center">
      <Text color={ACCENT} bold>
        {FRAMES[tick % FRAMES.length]}
      </Text>
      <Text color={ACCENT}>{props.label + dots}</Text>
    </Box>
  )
}

export default Spinner
