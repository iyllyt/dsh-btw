# Third-party notices

`dsh-btw` is an independent plugin for DeepSeek Harness.

The cache-boundary adapter in `src/host/btw-pi-ai-adapter.ts` is a small,
version-pinned derivative/integration layer around DeepSeek Harness's
`PiAiAdapter` and pi-ai's public `onPayload` hook. DeepSeek Harness is licensed
under the MIT License:

- https://github.com/deepseek-ai/deepseek-harness
- pinned compatibility target: `@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.6`

The `/btw` interaction semantics and reminder text are compatible with the
behavior of Anthropic Claude Code's side-question feature. No Claude Code
runtime code is bundled into this package.
