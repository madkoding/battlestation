# Battlestation Frontend

Frontend dashboard for Battlestation, built with React + TypeScript + Vite.

## What it does

- Shows project and task boards (`todo`, `progress`, `qa`, `done`)
- Connects to backend REST API for CRUD and workflow actions
- Subscribes to WebSocket events for live activity updates
- Provides task/project dialogs, status badges, and activity views

## Main folders

- `src/components/` UI and feature components
- `src/hooks/` app hooks (`useTheme`, `useWebSocket`)
- `src/lib/` API client and utility helpers
- `src/stores/` state stores
- `src/types/` shared TypeScript types

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Backend integration

- API base expected at `http://localhost:18794/api`
- WebSocket expected at `ws://localhost:18794/ws` (or dedicated WS port)

Run backend first from repository root:

```bash
./start.sh
```
