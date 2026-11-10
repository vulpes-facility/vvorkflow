import { useId, useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorMark,
  Input,
} from '@/shared/ui'

interface NewProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Makes the project with this name. When it rejects, the dialog stays open
   * and shows the message of the error.
   */
  onCreate: (name: string) => Promise<void>
}

/**
 * The dialog that asks for the name of a new project. It starts empty each
 * time it opens, and closes after the project is made. The engine checks the
 * name; its refusal shows as an error icon next to the name.
 */
export function NewProjectDialog({
  open,
  onOpenChange,
  onCreate,
}: NewProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <NewProjectForm
          onCreate={onCreate}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function NewProjectForm({
  onCreate,
  onDone,
}: {
  onCreate: (name: string) => Promise<void>
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const field = useId()
  const alert = useId()

  async function create() {
    setPending(true)
    setError(undefined)
    try {
      await onCreate(name.trim())
      onDone()
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
      </DialogHeader>
      <div className="grid gap-1.5">
        <label
          htmlFor={field}
          className="text-xs font-medium text-muted-foreground"
        >
          Name
        </label>
        <div className="flex items-center gap-1">
          <Input
            id={field}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(undefined)
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? alert : undefined}
          />
          {error && (
            // The tooltip opens above the icon, so that it does not cover the buttons.
            <ErrorMark
              label="Name error"
              message={error}
              messageId={alert}
              side="top"
            />
          )}
        </div>
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={!name.trim() || pending}>
          Create
        </Button>
      </DialogFooter>
    </form>
  )
}
