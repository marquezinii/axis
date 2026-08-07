# AgentOS icon

Source: `AgentOS_icone_sem_fundo_CORRIGIDO_recortado.png` (transparent
background, official AgentOS mark).

- `icon.png` — source, used for Linux/macOS packaging and in-app display
- `icon.ico` — generated multi-resolution Windows icon, used for the
  Electron app icon, window icon, installer icon, and desktop shortcut

Regenerate `icon.ico` after replacing `icon.png`:

    npx --yes png-to-ico assets/icon/icon.png > assets/icon/icon.ico
