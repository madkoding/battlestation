# BattleStation

BattleStation es una plataforma de orquestacion de agentes de IA para desarrollo de software.

En terminos simples: te da un tablero Kanban + API + agentes autonomos para convertir tareas en trabajo ejecutado y revisado, con trazabilidad de extremo a extremo.

## Que problema resuelve

- Coordinar tareas tecnicas sin perder contexto.
- Automatizar el flujo `TODO -> PROGRESS -> QA -> DONE`.
- Delegar implementacion y validacion a agentes especializados.
- Mantener evidencia y estado en un solo lugar.

## Como funciona

BattleStation esta dividido en tres partes:

- **Backend**: expone REST/WebSocket, guarda estado de proyectos/tareas y ejecuta el loop de orquestacion.
- **Frontend**: dashboard para ver proyectos, tablero Kanban, actividad en vivo y detalle de tareas.
- **Agentes**:
  - `kosmos`: orquestador (elige tareas, asigna flujo).
  - `vicks`: developer (implementa cambios).
  - `wedge`: QA (valida y aprueba/rechaza).

## Resultado esperado

Cuando una tarea entra al sistema, BattleStation puede moverla por el flujo completo con intervencion humana minima, dejando comentarios, decisiones y evidencia del proceso.

## Estado del proyecto

Repositorio en evolucion activa. La meta es tener una base local-first y operable para equipos pequenos que quieran automatizar su delivery con agentes.
