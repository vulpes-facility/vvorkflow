import { z } from 'zod'

export const protocol = z.object({
  attach_session: z
    .object({ session: z.string() })
    .describe(
      'Attaches the connection to a session: the screen of the session comes as\na binary frame, and then each byte of its output. A second attach sends\nthe screen again.',
    ),
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
  create_project: z
    .object({
      name: z
        .string()
        .describe(
          'The name of the folder: one name that each system accepts, which does\nnot start with a dot.',
        ),
    })
    .describe(
      'Makes a project: a new, empty folder directly in the projects root.',
    ),
  create_session: z
    .object({
      columns: z.number().int().gte(2).lte(500),
      rows: z.number().int().gte(1).lte(200),
      worktree: z
        .union([
          z
            .string()
            .describe(
              'The absolute path of an open worktree, where the shell starts. None\nis the projects root.',
            ),
          z
            .null()
            .describe(
              'The absolute path of an open worktree, where the shell starts. None\nis the projects root.',
            ),
        ])
        .describe(
          'The absolute path of an open worktree, where the shell starts. None\nis the projects root.',
        )
        .default(null),
    })
    .describe(
      'Starts the shell of the user in a new pseudo-terminal. The request has no\ncommand: the user types each command (core value 6).',
    ),
  detach_session: z
    .object({ session: z.string() })
    .describe('Detaches the connection from a session; the session continues.'),
  directory_entry: z
    .object({ kind: z.enum(['file', 'folder']), name: z.string() })
    .describe('An entry of a folder.'),
  done: z
    .record(z.string(), z.any())
    .describe('The answer of a request that has no value.'),
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
  event: z
    .any()
    .superRefine((x, ctx) => {
      const schemas = [
        z
          .object({
            event: z.literal('session.ended'),
            params: z
              .object({
                exitCode: z
                  .union([
                    z
                      .number()
                      .int()
                      .gte(0)
                      .describe(
                        'The exit code of the shell, or none when a signal ended it.',
                      ),
                    z
                      .null()
                      .describe(
                        'The exit code of the shell, or none when a signal ended it.',
                      ),
                  ])
                  .describe(
                    'The exit code of the shell, or none when a signal ended it.',
                  )
                  .optional(),
                session: z.string(),
                signal: z
                  .union([
                    z
                      .number()
                      .int()
                      .describe(
                        'The signal that ended the shell, or none. Always none on Windows.',
                      ),
                    z
                      .null()
                      .describe(
                        'The signal that ended the shell, or none. Always none on Windows.',
                      ),
                  ])
                  .describe(
                    'The signal that ended the shell, or none. Always none on Windows.',
                  )
                  .optional(),
              })
              .describe('The end of the shell of a session.'),
          })
          .describe(
            'The shell of a session ended. No frame of that session follows.',
          ),
        z
          .object({
            event: z.literal('session.resized'),
            params: z
              .object({
                columns: z.number().int().gte(2).lte(500),
                rows: z.number().int().gte(1).lte(200),
                session: z.string(),
              })
              .describe('The new size of a session.'),
          })
          .describe('A session has a new size, from the output that follows.'),
        z
          .object({
            event: z.literal('connection.closed'),
            params: z
              .record(z.string(), z.any())
              .describe(
                'The end of the connection of the app core to the engine.',
              ),
          })
          .describe(
            'The connection of the app core to the engine ended. Only the app core\nsends it, after the last frame of that connection.',
          ),
      ]
      const { errors, failed } = schemas.reduce<{
        errors: z.core.$ZodIssue[]
        failed: number
      }>(
        ({ errors, failed }, schema) =>
          ((result) =>
            result.error
              ? {
                  errors: [...errors, ...result.error.issues],
                  failed: failed + 1,
                }
              : { errors, failed })(schema.safeParse(x)),
        { errors: [], failed: 0 },
      )
      const passed = schemas.length - failed
      if (passed !== 1) {
        ctx.addIssue(
          errors.length
            ? {
                path: [],
                code: 'invalid_union',
                errors: [errors],
                message:
                  'Invalid input: Should pass single schema. Passed ' + passed,
              }
            : {
                path: [],
                code: 'custom',
                errors: [errors],
                message:
                  'Invalid input: Should pass single schema. Passed ' + passed,
              },
        )
      }
    })
    .describe(
      'A message without an id, which the engine can send at any time after\n`hello`, between the answers. The engine sends the events of a session\nonly to its attached clients.',
    ),
  hello: z
    .object({ protocol: z.number().int().gte(0) })
    .describe('Starts a connection with the protocol version of the client.'),
  kill_session: z
    .object({ session: z.string() })
    .describe(
      'Ends a session: the shell and its foreground job get SIGHUP, and SIGKILL\nafter 3 seconds.',
    ),
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
  list_projects: z
    .record(z.string(), z.any())
    .describe('Lists the projects: the folders directly in the projects root.'),
  list_sessions: z
    .record(z.string(), z.any())
    .describe('Lists the terminal sessions of the engine.'),
  open_folder: z
    .object({
      path: z
        .string()
        .describe('An absolute path on the machine of the engine.'),
    })
    .describe(
      'Opens a folder: a git repository, or a plain folder.\nThe engine adds the folder, and each worktree of its repository, to the\nroots that later requests can reach (core value 6).',
    ),
  project: z
    .object({
      git: z.boolean().describe('True when the folder has a `.git` entry.'),
      name: z.string(),
      path: z
        .string()
        .describe('The absolute path, which `folder.open` takes.'),
    })
    .describe('A folder directly in the projects root.'),
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
          .describe('One worktree of a repository.'),
      ),
    })
    .describe(
      'A repository and its worktrees, or a plain folder as one worktree.',
    ),
  request: z
    .any()
    .superRefine((x, ctx) => {
      const schemas = [
        z
          .object({
            method: z.literal('hello'),
            params: z
              .object({ protocol: z.number().int().gte(0) })
              .describe(
                'Starts a connection with the protocol version of the client.',
              ),
          })
          .describe('The first request of a connection. Answers [`Welcome`].'),
        z
          .object({
            method: z.literal('project.list'),
            params: z
              .record(z.string(), z.any())
              .describe(
                'Lists the projects: the folders directly in the projects root.',
              ),
          })
          .describe('Answers each [`Project`] in the projects root.'),
        z
          .object({
            method: z.literal('project.create'),
            params: z
              .object({
                name: z
                  .string()
                  .describe(
                    'The name of the folder: one name that each system accepts, which does\nnot start with a dot.',
                  ),
              })
              .describe(
                'Makes a project: a new, empty folder directly in the projects root.',
              ),
          })
          .describe(
            'Makes a folder in the projects root. Answers its [`Project`].',
          ),
        z
          .object({
            method: z.literal('folder.open'),
            params: z
              .object({
                path: z
                  .string()
                  .describe('An absolute path on the machine of the engine.'),
              })
              .describe(
                'Opens a folder: a git repository, or a plain folder.\nThe engine adds the folder, and each worktree of its repository, to the\nroots that later requests can reach (core value 6).',
              ),
          })
          .describe('Answers a [`Repository`].'),
        z
          .object({
            method: z.literal('directory.list'),
            params: z
              .object({
                path: z
                  .string()
                  .describe(
                    'The folder, relative to the worktree, with `/` between the names.\nAn empty path is the worktree itself.',
                  ),
                worktree: z
                  .string()
                  .describe('The absolute path of the worktree.'),
              })
              .describe(
                'Lists one folder of a worktree. The engine reads only this folder, so that\na large tree, such as `node_modules`, costs nothing until the user opens it.',
              ),
          })
          .describe('Answers each [`DirectoryEntry`] of the folder.'),
        z
          .object({
            method: z.literal('git.status'),
            params: z
              .object({
                worktree: z
                  .string()
                  .describe('The absolute path of the worktree.'),
              })
              .describe('Reads the git status of a worktree.'),
          })
          .describe('Answers each [`ChangedPath`] of the worktree.'),
        z
          .object({
            method: z.literal('session.list'),
            params: z
              .record(z.string(), z.any())
              .describe('Lists the terminal sessions of the engine.'),
          })
          .describe(
            'Answers each [`Session`] of the engine, in the order of its start.',
          ),
        z
          .object({
            method: z.literal('session.create'),
            params: z
              .object({
                columns: z.number().int().gte(2).lte(500),
                rows: z.number().int().gte(1).lte(200),
                worktree: z
                  .union([
                    z
                      .string()
                      .describe(
                        'The absolute path of an open worktree, where the shell starts. None\nis the projects root.',
                      ),
                    z
                      .null()
                      .describe(
                        'The absolute path of an open worktree, where the shell starts. None\nis the projects root.',
                      ),
                  ])
                  .describe(
                    'The absolute path of an open worktree, where the shell starts. None\nis the projects root.',
                  )
                  .default(null),
              })
              .describe(
                'Starts the shell of the user in a new pseudo-terminal. The request has no\ncommand: the user types each command (core value 6).',
              ),
          })
          .describe(
            'Starts the shell of the user in a new pseudo-terminal. Answers its\n[`Session`].',
          ),
        z
          .object({
            method: z.literal('session.attach'),
            params: z
              .object({ session: z.string() })
              .describe(
                'Attaches the connection to a session: the screen of the session comes as\na binary frame, and then each byte of its output. A second attach sends\nthe screen again.',
              ),
          })
          .describe(
            'Sends the screen and then the output of a session to this connection.\nAnswers the [`Session`].',
          ),
        z
          .object({
            method: z.literal('session.detach'),
            params: z
              .object({ session: z.string() })
              .describe(
                'Detaches the connection from a session; the session continues.',
              ),
          })
          .describe(
            'Stops the output of a session to this connection. Answers [`Done`].',
          ),
        z
          .object({
            method: z.literal('session.write'),
            params: z
              .object({
                data: z
                  .string()
                  .describe(
                    'The input bytes in Base64 (RFC 4648, with padding).',
                  ),
                session: z.string(),
              })
              .describe('Sends input to the program of a session.'),
          })
          .describe(
            'Puts input bytes in the input queue of a session. Answers [`Done`].',
          ),
        z
          .object({
            method: z.literal('session.resize'),
            params: z
              .object({
                columns: z.number().int().gte(2).lte(500),
                rows: z.number().int().gte(1).lte(200),
                session: z.string(),
              })
              .describe(
                'Changes the size of the pseudo-terminal and of the kept screen.',
              ),
          })
          .describe('Changes the size of a session. Answers [`Done`].'),
        z
          .object({
            method: z.literal('session.kill'),
            params: z
              .object({ session: z.string() })
              .describe(
                'Ends a session: the shell and its foreground job get SIGHUP, and SIGKILL\nafter 3 seconds.',
              ),
          })
          .describe(
            'Ends a session as the close of a terminal window does. Answers\n[`Done`]; the event `session.ended` follows.',
          ),
        z
          .object({
            method: z.literal('shutdown'),
            params: z
              .object({
                force: z
                  .boolean()
                  .describe(
                    'False, or not set: an engine with sessions refuses to stop. True: the\nengine ends each session, and then stops.',
                  )
                  .default(false),
              })
              .describe('Stops the engine process.'),
          })
          .describe(
            'Stops the engine process. Answers [`Done`], then the process stops.\nIt is valid before `hello`, and its shape never changes from protocol\n3, so that each app can stop an engine of another version.',
          ),
      ]
      const { errors, failed } = schemas.reduce<{
        errors: z.core.$ZodIssue[]
        failed: number
      }>(
        ({ errors, failed }, schema) =>
          ((result) =>
            result.error
              ? {
                  errors: [...errors, ...result.error.issues],
                  failed: failed + 1,
                }
              : { errors, failed })(schema.safeParse(x)),
        { errors: [], failed: 0 },
      )
      const passed = schemas.length - failed
      if (passed !== 1) {
        ctx.addIssue(
          errors.length
            ? {
                path: [],
                code: 'invalid_union',
                errors: [errors],
                message:
                  'Invalid input: Should pass single schema. Passed ' + passed,
              }
            : {
                path: [],
                code: 'custom',
                errors: [errors],
                message:
                  'Invalid input: Should pass single schema. Passed ' + passed,
              },
        )
      }
    })
    .describe('A request to the engine: its method, and its params.'),
  resize_session: z
    .object({
      columns: z.number().int().gte(2).lte(500),
      rows: z.number().int().gte(1).lte(200),
      session: z.string(),
    })
    .describe(
      'Changes the size of the pseudo-terminal and of the kept screen.',
    ),
  session: z
    .object({
      columns: z.number().int().gte(2).lte(500),
      folder: z
        .string()
        .describe('The absolute path of the folder where the shell started.'),
      id: z
        .string()
        .describe(
          '16 characters, each a digit or a lowercase letter from `a` to `f`.',
        ),
      rows: z.number().int().gte(1).lte(200),
      title: z
        .string()
        .describe(
          'The last title that the program set, or the name of the shell.',
        ),
    })
    .describe(
      'A terminal session: a pseudo-terminal with the shell of the user in it.',
    ),
  shutdown: z
    .object({
      force: z
        .boolean()
        .describe(
          'False, or not set: an engine with sessions refuses to stop. True: the\nengine ends each session, and then stops.',
        )
        .default(false),
    })
    .describe('Stops the engine process.'),
  welcome: z
    .object({
      protocol: z.number().int().gte(0),
      root: z.string().describe('The absolute path of the projects root.'),
    })
    .describe(
      'The answer to [`Hello`] when the engine speaks the protocol of the client.',
    ),
  write_session: z
    .object({
      data: z
        .string()
        .describe('The input bytes in Base64 (RFC 4648, with padding).'),
      session: z.string(),
    })
    .describe('Sends input to the program of a session.'),
})
