# Ricardo & Carol

PWA partilhada para compras, tarefas, notificações e sincronização em tempo real.

## Estrutura

- `index.html`
- `styles.css`
- `app.js`
- `manifest.json`
- `service-worker.js`
- `assets/`

## Firebase

A app usa o projeto `ricardo-carol-app`, autenticação anónima e Firestore em:

- `casal/principal/compras`
- `casal/principal/tarefas`
- `casal/principal/logs`
- `casal/principal/tokens`

As notificações push ficam preparadas. Para ativar push real entre dispositivos, coloca a Web Push certificate key do Firebase em `VAPID_KEY`, dentro de `app.js`.
