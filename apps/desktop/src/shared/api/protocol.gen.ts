import { z } from 'zod'

export const protocol = z.object({
  changed_path: z
    .object({
      path: z.string(),
      status: z.enum([
        'added',
        'modified',
        'deleted',
        'untracked',
        'conflict',
        'ignored',
      ]),
    })
    .describe(
      'A path with a git status, relative to its worktree, with `/` between the\nnames. A folder that git reports as a whole, such as an ignored or an\nuntracked folder, ends with `/`.',
    ),
  directory_entry: z
    .object({ kind: z.enum(['file', 'folder']), name: z.string() })
    .describe('An entry of a folder.'),
  engine_error: z
    .object({
      code: z
        .enum([
          'notFound',
          'permissionDenied',
          'invalidArgument',
          'failedPrecondition',
        ])
        .describe(
          'The kind of an error: `notFound`, the path does not exist;\n`permissionDenied`, the path is outside the roots that the engine can\nreach; `invalidArgument`, the request is not valid, for example a relative\npath; `failedPrecondition`, the state does not let the request occur, for\nexample git is missing. The variants have no doc comments of their own,\nso that the schema keeps them as one plain enum.',
        ),
      message: z.string().describe('A sentence for the user.'),
    })
    .describe('A refused or failed request.'),
  list_directory: z
    .object({
      path: z
        .string()
        .describe(
          'The folder, relative to the worktree, with `/` between the names.\nAn empty path is the worktree itself.',
        ),
      worktree: z.string().describe('The absolute path of the worktree.'),
    })
    .describe(
      'Lists one folder of a worktree. The engine reads only this folder, so that\na large tree, such as `node_modules`, costs nothing until the user opens it.',
    ),
  open_folder: z
    .object({
      path: z
        .string()
        .describe('An absolute path on the machine of the engine.'),
    })
    .describe(
      'Opens a folder: a git repository, or a plain folder.\nThe engine adds the folder, and each worktree of its repository, to the\nroots that later requests can reach (core value 6).',
    ),
  read_status: z
    .object({
      worktree: z.string().describe('The absolute path of the worktree.'),
    })
    .describe('Reads the git status of a worktree.'),
  repository: z
    .object({
      git: z
        .boolean()
        .describe('False for a plain folder, which has no git status.'),
      name: z.string().describe('The name of the folder of the main worktree.'),
      worktrees: z.array(
        z
          .object({
            branch: z
              .union([
                z
                  .string()
                  .describe(
                    'The checked-out branch, without `refs/heads/`. None when the HEAD is\ndetached, or for a plain folder.',
                  ),
                z
                  .null()
                  .describe(
                    'The checked-out branch, without `refs/heads/`. None when the HEAD is\ndetached, or for a plain folder.',
                  ),
              ])
              .describe(
                'The checked-out branch, without `refs/heads/`. None when the HEAD is\ndetached, or for a plain folder.',
              )
              .optional(),
            current: z
              .boolean()
              .describe('True for the worktree of the opened folder.'),
            path: z.string().describe('The absolute path of the worktree.'),
          })
          .describe(
            'One worktree of a repository. In vvorkflow, one worktree is one project.',
          ),
      ),
    })
    .describe(
      'A repository and its worktrees, or a plain folder as one worktree.',
    ),
})
