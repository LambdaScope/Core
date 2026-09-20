# LambdaScope UI

Real-time dashboard for AWS Lambda syscall/network/FD observability.
The audience is hackathon judges and security engineers. The anomaly view is the star.

## Stack
React + Vite + TypeScript + Tailwind v4 (via @tailwindcss/vite) + Recharts + Zustand + react-router-dom.
Do not add other UI libraries without asking me.

## Design
- Dark, terminal-inspired. Neutral dark base, one green accent.
- Strict severity scale: info (blue), warning (amber), critical (red).
- Critical anomalies are the loudest thing on screen.
- Monospace for syscalls, hosts, IDs, numbers. Clean sans for everything else.

## Data rules
- All data flows through src/data/ (a WebSocket-shaped client and a store).
- Components never import mock data directly. They only use store hooks.
- Never crash on missing data. In "proc" mode, syscalls, memory and spans can be empty.
- Show "n/a" or an empty state for missing data, never 0 or a blank panel.
- DO NOT edit src/types.ts without asking me first. It is the contract with the backend.

## Quality rules
- Every component needs loading, empty, and populated states.
- After building anything, run the app and verify it in the browser with a screenshot.
- Keep components small and in their own files.

UI-only project. No backend, no network requests, no env vars. All data is local static or simulated data.