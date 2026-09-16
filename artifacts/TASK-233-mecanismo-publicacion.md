# TASK-233 AC1 — el mecanismo real de publicacion del plugin, verificado

No es un documento de diseno: cada afirmacion de abajo fue medida en esta misma maquina el
2026-09-16, con los comandos que se listan, antes de escribirse aca. Donde no pude verificar algo
lo digo explicitamente en vez de inventarlo.

## 1. Marketplace y cache por version

- Marketplace registrado: `hivemind-marketplace`, fuente git
  `https://github.com/HexingBot/hivemind.git`.
- El marketplace en si se clona en `~/.claude/plugins/marketplaces/hivemind-marketplace`.
- Cada version instalada del plugin `hivemind` queda cacheada en un directorio propio:
  `~/.claude/plugins/cache/hivemind-marketplace/hivemind/<version>` — no se pisa la version
  anterior, cada `<version>` es un checkout completo independiente.
- Instalacion actual medida (`~/.claude/plugins/installed_plugins.json`):

  ```json
  {
    "version": 2,
    "plugins": {
      "hivemind@hivemind-marketplace": [
        {
          "scope": "user",
          "installPath": "/opt/data/home/.claude/plugins/cache/hivemind-marketplace/hivemind/0.22.0",
          "version": "0.22.0",
          "installedAt": "2026-08-26T19:01:44.360Z",
          "lastUpdated": "2026-08-26T19:01:44.360Z",
          "gitCommitSha": "468f5a2864ffcc058195a2ed5ddac08f0f1e0408"
        }
      ]
    }
  }
  ```

  Esto confirma tres cosas a la vez: (a) el cache-por-version (`.../hivemind/0.22.0`), (b) el
  scope `"user"` (no hay entrada por proyecto — una sola instalacion sirve a TODA la maquina), y
  (c) el pin por `gitCommitSha` (`468f5a2...`), que es lo que ancla exactamente que commit del
  repo quedo empaquetado en esa version.

## 2. `.claude/agents/` y `.claude/skills/` de un proyecto OVERRIDEAN al plugin

Verificado, no asumido: de los proyectos con `PROJECT.md` en esta maquina —

```
$ find / -maxdepth 5 -iname "PROJECT.md" 2>/dev/null | grep -v node_modules | grep -v /.claude/plugins/cache
```

hay **11 proyectos consumidores** reales bajo `/opt/data/home/` (fuera del propio repo `hivemind`):
`western-defense`, `gmatovelle-website`, `blog-component`, `sincero`, `meta-harvester`,
`cris-hidalgo`, `medicos-quito`, `cranialTrading`, `qa-agents`, `iwa-wallet`, `agent-framework`.

De esos 11, se inspecciono `.claude/agents/` y `.claude/skills/` de cada uno:

| Proyecto | `.claude/agents/{developer,researcher,reviewer}.md` propios | `.claude/skills/orchestrator-routing/` propio |
|---|---|---|
| western-defense | no | no |
| gmatovelle-website | no | no |
| blog-component | no | no |
| sincero | no | no |
| meta-harvester | no | no |
| cris-hidalgo | no | no |
| medicos-quito | no | no |
| cranialTrading | no | no |
| qa-agents | no | no |
| iwa-wallet | no | no |
| **agent-framework** | **si (developer.md, researcher.md, reviewer.md)** | **si (SKILL.md)** |

**`agent-framework` es el unico de los 11 con copias locales completas, y estan STALE:**

```
$ grep -n "absent means" /opt/data/home/agent-framework/.claude/agents/developer.md
16:- The ticket's `verification_tier` (`tdd`, `tests-after`, or `uat-only`; absent means `tdd`).
```

Esa copia local carga exactamente la misma frase retirada que el cache del plugin v0.22.0. La
consecuencia operativa es la que motiva este ticket: **actualizar el plugin (bump de version +
reinstalacion) NO alcanza a `agent-framework`**, porque Claude Code resuelve primero
`.claude/agents/*.md` y `.claude/skills/*/SKILL.md` del proyecto activo, y solo cae al plugin
cuando el proyecto no trae su propia copia. Los otros 10 proyectos SI van a quedar al dia con un
bump del plugin porque no tienen override local. `agent-framework` necesita una resincronizacion
aparte (copiar developer.md/researcher.md/reviewer.md/orchestrator-routing/SKILL.md actualizados
a su `.claude/`), no cubierta por este ticket — queda para el despacho del bump.

## 3. Lo que este ticket NO resuelve

Este ticket (TASK-233) construye el sensor y corrige las superficies del REPO. El bump de version
y la publicacion del plugin (cortar `0.23.0` o la que corresponda, actualizar
`installed_plugins.json`, y — separado — resincronizar `agent-framework`) los hace el Orquestador
despues del cierre de este ticket, segun la autorizacion en bloque de Mato registrada en el
comentario de constancia del ticket.
