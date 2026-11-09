import { shortcutKeys, type Platform } from '../lib'
import { Kbd, KbdGroup } from './kbd'

/** The keys of a shortcut such as `mod+shift+p`, as the platform shows them. */
export function Shortcut({
  keys,
  platform,
}: {
  keys: string
  platform: Platform
}) {
  return (
    <KbdGroup>
      {shortcutKeys(keys, platform).map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  )
}
