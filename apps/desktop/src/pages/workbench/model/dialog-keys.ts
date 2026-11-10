/**
 * Whether a key comes from a dialog. A dialog keeps its keys: the shortcuts
 * of the window do nothing while the focus is in one, so that they do not
 * move the focus out of a modal dialog or change the window under it.
 */
export function isDialogKey(event: KeyboardEvent): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest('[role="dialog"]') !== null
  )
}
