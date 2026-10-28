# Contributing to Squashflow

Thanks for your interest in Squashflow. The project is in early development and there is no product code yet, so the most useful contributions right now are feedback on the [planned design](docs/architecture.md) and the [security model](SECURITY.md). Open an issue to start a discussion.

By taking part, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

There is nothing to build yet. Once the first package lands, this section will cover:

- the required Node.js version and package manager,
- how to install dependencies from the lockfile,
- how to run the helper, the extension and the tests locally.

## Branches and pull requests

`main` is protected: every change goes through a pull request, force-pushes and branch deletion are blocked, history must stay linear, and the rules apply to administrators too.

1. Fork the repository, or create a branch if you have write access. Use a short descriptive branch name, for example `feat/session-picker` or `fix/pairing-timeout`.
2. Keep each pull request focused on one change.
3. Make sure checks pass and describe what you changed and how you tested it.
4. Pull requests are merged with **squash merge**, so the pull request title becomes the commit message on `main`. Write it as a conventional commit (see below).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) style:

```text
<type>: <short description>

<optional body explaining why>
```

Common types:

| Type | Use for |
| --- | --- |
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or fixing tests |
| `perf` | Performance improvement |
| `chore` | Tooling, dependencies, housekeeping |
| `ci` | CI configuration and workflows |

## Never commit secrets

Do not commit API keys, tokens, passwords, pairing tokens, `.env` files or any other credentials. `.env` files are ignored by git, and GitHub secret scanning with push protection is enabled on this repository, but treat those as a safety net, not permission. If you commit a secret by accident, revoke it straight away; removing it from history does not make it safe again.

## Third-party code

Squashflow is MIT licensed. Only contribute code you wrote yourself or code under a compatible license, with attribution. In particular, Squashflow's features are inspired by [Agentation](https://github.com/benjitaylor/agentation), which uses the PolyForm Shield license: do not copy code from it.

## Reporting security issues

Do not report security problems in public issues or pull requests. Follow [SECURITY.md](SECURITY.md) to report them privately.
