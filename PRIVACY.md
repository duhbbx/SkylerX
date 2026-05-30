# Privacy Policy

_Last updated: 2026-05-30_

SkylerX is a desktop application that runs **entirely on the user's device**.
It is not a cloud service and does not have a server that collects user data.

## What we do NOT collect

- **No telemetry / analytics**: SkylerX does not transmit usage data, feature usage statistics, crash reports, or any form of analytics.
- **No tracking**: No advertising IDs, fingerprinting, or third-party trackers are embedded in the application.
- **No account required**: SkylerX does not require sign-up, login, or any user account to function.

## What stays on your device

The following data is stored **only on the user's local file system** and never leaves the device unless the user explicitly transmits it:

- Database connection configurations (encrypted with OS-level `safeStorage` where available)
- Query history
- Settings, preferences, themes, key bindings
- AI provider configuration (API keys, custom instructions, memory/facts)
- Locally cached metadata for connection tree

## Network requests SkylerX makes

| Purpose | Destination | What is sent |
|---------|-------------|--------------|
| **Database connections** | The user-configured database host(s) | SQL queries the user explicitly executes |
| **AI assistance** _(only if user enables and configures it)_ | The user-configured AI provider (OpenAI / Anthropic / DeepSeek / Ollama / etc.) | Prompts + SQL context **explicitly invoked** by the user; SkylerX does not act as a proxy or log these requests |
| **Auto-update checks** | `github.com/duhbbx/SkylerX/releases` (default), or `skylerx-build.oss-cn-shanghai.aliyuncs.com` if the user selects the China mirror | Only a standard HTTPS `GET` for the update manifest; no user-identifying information is included |
| **Documentation links** | When the user clicks an external link in the app | Standard browser navigation; SkylerX itself does not transmit anything |

## Third-party services

SkylerX **does not integrate any third-party SDKs** (no analytics, no error reporting, no advertising).
The only optional integrations are AI providers, which are user-configured and the connection is direct between the desktop app and the provider chosen by the user.

## Open source transparency

SkylerX is fully open source under the [Apache-2.0 License](https://github.com/duhbbx/SkylerX/blob/main/LICENSE).
The entire source code, including all network call sites, is auditable at https://github.com/duhbbx/SkylerX.

## Contact

For privacy-related questions, please open an issue at https://github.com/duhbbx/SkylerX/issues or email duhbbx@gmail.com.
