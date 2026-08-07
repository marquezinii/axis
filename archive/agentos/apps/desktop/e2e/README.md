# E2E tests

`golden-path.spec.ts` drives the real built app end-to-end, including a real
call to the Claude Agent SDK. It requires:

- The app built (`npm run build`)
- An authenticated Claude Code session on the machine running the test

This test is not run in environments without Claude Code authentication.
