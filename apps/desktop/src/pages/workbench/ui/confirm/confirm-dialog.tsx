import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The question, which names what the action ends or removes. */
  title: string
  /** The name of the action, on its button. */
  action: string
  onConfirm: () => void
  /**
   * The element that gets the focus after the dialog closes. Give it when
   * the action can take away the control that opened the dialog.
   */
  finalFocus?: () => HTMLElement | null | undefined
}

/**
 * A question before an action that the user cannot take back. The dialog
 * opens with the focus on Cancel, so that Enter does not do the action by
 * accident; Escape and Cancel close it with no action.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  action,
  onConfirm,
  finalFocus,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        finalFocus={finalFocus && (() => finalFocus() ?? true)}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            className="border-destructive"
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
