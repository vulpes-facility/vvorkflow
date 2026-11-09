# Engine

The engine follows values 4 and 6 of the [core values](../core-values.md).\
These rules keep each request of the protocol inside the folders that the user opened.

1. A request can reach only a root: a folder that the user opened, or a worktree of its repository.\
   A path in a request is absolute for a root, and relative to the root for a folder in it.\
   A relative path MUST hold plain names only, with no `..`, no `.`, and no root.
2. The engine opens each root as a directory handle (`cap-std`), and reads the folders through it.\
   So a path that turns into a symbolic link later cannot lead a read out of the root.\
   A symbolic link that stays in the root works.
3. Git takes paths, not handles.\
   So the engine runs git with the git directory and the worktree that git named when the folder opened, and git never looks for a repository above the root.\
   Just before git runs, the engine checks that the path of the root still leads to its handle.
4. Known limit: between that check and the git process, another process could replace the folder.\
   Git would then report the names and the statuses of another folder that the user can read.\
   Only a process that runs as the user can do this, and such a process can read that folder itself.\
   The terminals of the engine also run as the user.\
   So this limit does not give a client more than the user has.
5. A worktree whose folder is gone, but that git still lists, is left out of the repository.
