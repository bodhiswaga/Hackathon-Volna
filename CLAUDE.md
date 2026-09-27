# CLAUDE.md — «Волна»: управление рисками и изменениями в проекте

Хакатон-кейс 1 «Проект начинает срываться» (ТЗ: `docs/tz.pdf`). Веб-приложение для руководителя проекта:
задачи, зависимости, критический путь и **what-if анализ последствий изменений**. Главный вопрос продукта:
«Если сейчас что-то изменится, что произойдёт с проектом и на что мне обратить внимание?»

Контекст: разработчик один (реализацию ведёт Claude), предзащита 2026-09-28. Приоритет — работающий
сквозной демо-сценарий (`docs/demo-script.md`), а не ширина CRUD. Язык интерфейса — русский.

## Стек и почему

| Слой | Выбор | Почему |
|---|---|---|
| Монорепо | npm workspaces, TypeScript (strict, ESM) | Один язык; движок расчёта общий для клиента и сервера |
| Движок | `packages/engine` — чистый TS без зависимостей, тесты vitest | Мгновенное what-if превью в браузере и та же валидация на сервере |
| Backend | Fastify 5 + zod 4 + `node:sqlite` (встроен в Node ≥ 22), запуск через tsx | Без нативной сборки (better-sqlite3/Prisma 7 на Node 25 + Windows рискованны); SQL простой |
| Frontend | React 19 + Vite 8, Tailwind v4, TanStack Query 5, Zustand 5 | Быстрая разработка; Zustand держит черновик ChangeSet |
| Визуализация | Собственный SVG-Gantt; граф — @xyflow/react 12 + @dagrejs/dagre (раскладка сверху вниз) | Gantt под наши нужды (волна, призраки, резерв, критический путь) |
| Шрифты / иконки | Onest (UI), Unbounded (заголовки) — Google Fonts; lucide-react | — |

Перед использованием API любой библиотеки сверяться с документацией через Context7.

## Структура проекта

```
CLAUDE.md, Dockerfile, package.json      # workspaces: dev / start / test / seed / typecheck / build
packages/engine/src/
  types.ts       # доменные типы (Project, Person, Task, Dependency, ChangeOp, Analysis…)
  calendar.ts    # рабочие дни ↔ даты, форматирование
  graph.ts       # смежность, топосортировка Кана, поиск цикла
  analyze.ts     # CPM (прямой/обратный проход), флаги, алерты, здоровье проекта
  changeset.ts   # applyChangeSet, statusPatch, mergeOps, describeOps
  impact.ts      # diffAnalyses: волна, цепочки причин, вердикт
  advisor.ts     # советник: варианты ускорения, переназначения, план восстановления
packages/engine/test/                    # vitest
apps/server/src/
  index.ts       # Fastify, обработчик ошибок, раздача apps/web/dist в продакшне
  db.ts, schema.sql, repo.ts             # node:sqlite, транзакции, маппинг snake_case ↔ camelCase
  routes/projects.ts                     # REST API
  schemas.ts     # zod-схемы входа
  seed.ts        # демо-проект (даты относительно сегодня)
apps/web/src/
  api/           # client.ts (fetch), hooks.ts (TanStack Query)
  store/draft.ts # Zustand: черновик ops, выбранная задача, вкладка, тосты
  lib/           # model.ts (base + черновик → анализ + impact), format.ts, router.ts (hash-роутинг)
  pages/         # ProjectsPage, ProjectPage
  components/    # StatusStrip, AttentionPanel, JournalView, TeamView, ui.tsx,
                 # gantt/, graph/, table/, task/TaskEditor, impact/ImpactPanel, advisor/AdvisorPanel
docs/tz.pdf, docs/demo-script.md
```

## Модель данных

Хранятся только «сырые» данные. Расчётные поля (ES/EF/LS/LF, резерв, флаги, критичность)
**никогда не пишутся в БД** — их всегда считает движок.

- **Project**: id, name, description, startDate, deadline, statusDate (nullable → «сегодня» = реальная дата), createdAt
- **Person**: id, projectId, name, role, color (ответственные — справочник, не аккаунты; авторизации нет)
- **Task**: id, projectId, name, description, durationDays (int ≥ 0, 0 = веха), status, assigneeId?, dueDate? (срок выполнения), startNotEarlier? (ограничение «не раньше»), actualStart?, actualEnd?, sortOrder
- **Dependency**: id, projectId, predecessorId, successorId, lagDays, UNIQUE(predecessorId, successorId). Только Finish→Start.
  `lagDays > 0` — пауза, `lagDays < 0` — нахлёст (не больше длительности предшественника).
- **ChangeEvent**: id, projectId, createdAt, title, reason?, ops_json, snapshot_before_json, finish/buffer before/after — журнал и откат

Статусы (ручные): `not_started | in_progress | blocked | done`.
Флаги (вычисляемые, `TaskFlags`): `critical`, `lowFloat`, `missesDueDate`, `pastDeadline`, `overdue`,
`blocked`, `blockedByPredecessor`, `overloaded`. Итог по задаче — `risk: none | medium | high`
(«под угрозой» = high).

## Алгоритмы

### Календарь (`calendar.ts`)
Рабочие дни пн–пт, праздники не учитываются. Абсолютный индекс рабочего дня (0 = пн 1970-01-05).
Задача занимает полуинтервал `[es, ef)`; дата окончания = последний рабочий день. Веха — событие в конце дня
перед `es`, у неё начало = окончанию.

### Расписание (CPM, `analyze.ts`)
1. Топосортировка (Kahn, стабильная по sortOrder). Цикл → `CycleError` с конкретным циклом (DFS).
2. Прямой проход:
   - `done` с actualEnd: даты фактические, не двигаются;
   - `in_progress` с actualStart: ES = actualStart, EF = max(ES + duration, today + 1);
   - иначе: ES = max(pred.EF + lag, startNotEarlier, today (кроме done), projectStart).
     При равенстве причиной считается зависимость; `driver` запоминает, что определило ES.
3. Финиш = max(EF). Обратный проход (выполненные последователи игнорируются) → LS/LF, float = LF − EF.
   Критические = незавершённые с float ≤ 0. Критические связи: pred.EF + lag = succ.ES, обе критические.
4. Запас = endIndex(deadline) − финиш.
5. Пороги: `LOW_FLOAT_DAYS = 2`, `LOW_BUFFER_DAYS = 2`. Выравнивания ресурсов нет:
   перегруз (пересечение задач одного человека) подсвечивается, но даты не меняет.
6. Здоровье: `intervention`, если есть high-алерт; `attention`, если есть medium-алерт; иначе `ok`.

### Анализ последствий (`changeset.ts`, `impact.ts`)
- `applyChangeSet(state, ops)` — чистая функция, валидирует и проверяет цикл. Ops: `updateTask`, `createTask`,
  `deleteTask`, `addDependency`, `removeDependency`, `updateDependency`, `updateProject`.
- `mergeOps` схлопывает правки одной задачи в один патч (черновик не разрастается).
- `diffAnalyses`: затронутые задачи (ΔES/ΔEF), цепочка причин по `driver` до изменённой задачи,
  Δ финиша, запас до/после, новые и снятые алерты (по `key`), изменения критического пути, заголовок, вердикт:
  `intervention` — запас < 0 или новый high-алерт; `attention` — финиш сдвинулся, новые алерты или критические задачи.
- UX: любая правка → `usePropose` (проверка движком) → черновик → расчёт на клиенте → волна + призраки
  + ImpactPanel → Применить (сервер повторно применяет тем же движком и пишет ChangeEvent) / Отменить.

### Контр-фича: советник по срокам (`advisor.ts`)
Кандидаты (каждый прогоняется через `applyChangeSet + analyze`):
ускорить критическую задачу (≤ `MAX_CRASH_SHARE` = 30%), нахлёст по критической связи (fast-tracking,
≤ `MAX_OVERLAP_SHARE` = 50% длительности предшественника), убрать паузу, снять «не раньше», переназначить
задачу перегруженного человека на свободного, перенести дедлайн (всегда последним).
Сила действия подбирается минимальной, которой хватает до дедлайна. Ранжирование: укладывается ли в дедлайн →
выигрыш → цена; если сроки в порядке — сначала то, что снимает текущие проблемы.
Жадный план: ≤ 5 шагов, на каждом — самый дешёвый шаг, закрывающий отставание, иначе самый сильный.
Советник работает по состоянию **с учётом черновика**; выбранный вариант добавляется в черновик.

## API (Fastify, префикс `/api`)
- `GET /health`
- `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id` — GET отдаёт project + people + tasks + dependencies;
  список проектов содержит здоровье, финиш, запас и статистику
- `POST/PATCH/DELETE /projects/:id/people[/:personId]`
- `POST /projects/:id/changes` `{ ops, reason?, title? }` — атомарно (транзакция + движок + ChangeEvent)
- `GET /projects/:id/changes`, `POST /projects/:id/changes/:eventId/revert` — откат к снимку «до» (сам откат тоже пишется в журнал)
- `POST /demo/reset` — пересоздать демо-проект (id `demo`)
- Ошибка: `{ error: { code, message, details? } }`; 400 — валидация/цикл, 404 — не найдено.

## Конвенции кода
- TypeScript strict, ESM, без `any` (при необходимости — `unknown` + сужение). Prettier: 2 пробела, одинарные кавычки, точки с запятой, ширина 100.
- Идентификаторы и имена файлов — на английском (camelCase / PascalCase для компонентов); тексты UI и комментарии — на русском. Комментируем только неочевидное.
- **Движок чистый**: без IO и без `new Date()` без аргументов — «сегодня» передаётся параметром. Любое изменение движка сопровождается тестом.
- **Все изменения задач и зависимостей идут только через ChangeSet** (`POST /changes`); отдельных CRUD-эндпоинтов для задач нет. Люди и сам проект (имя/описание) — обычный CRUD.
- Даты на границах (API, БД, UI) — строки `YYYY-MM-DD`. ID — `crypto.randomUUID()`.
- SQL-колонки в snake_case, маппинг — только в `repo.ts`. Вход API валидируется zod-схемами (`schemas.ts`).
- Типы домена объявляются один раз в `packages/engine/src/types.ts`.
- Frontend: серверное состояние — TanStack Query, черновик и UI — Zustand; производные данные (анализ, impact) — `useMemo` в `lib/model.ts`, не в state.
  Компоненты проекта берут модель через `useModel()`, правки отправляют через `usePropose()`.
- Дизайн-токены — в `apps/web/src/index.css` (`@theme`): ink, paper, cobalt (в работе), wave (сдвиг изменением), crimson (критично), moss (готово), ochre (блок). Оранжевый `wave` используется только для последствий изменений.
- Коммиты — только по запросу пользователя.

## Запуск локально

```bash
npm install
npm run dev       # web: http://127.0.0.1:5173 (Vite проксирует /api), api: http://127.0.0.1:3001
npm start         # продакшн: собрать фронт и поднять всё на http://localhost:3001
npm test          # тесты движка (vitest)
npm run typecheck # tsc по всем пакетам
npm run seed      # пересоздать демо-проект (то же делает кнопка «Сбросить демо»)
```

- БД: `apps/server/data/volna.db` (переопределяется `DB_PATH`), при пустой БД демо создаётся автоматически.
- Проект лежит в OneDrive: у Vite включён polling-watcher (`vite.config.ts`), иначе правки иногда не подхватываются.
- Docker: `docker build -t volna . && docker run -p 3001:3001 -v volna-data:/data volna`
  (Dockerfile написан, но **не проверен**: Docker Desktop не был запущен).

## Статус этапов
- [x] 0. Каркас (workspaces, Vite, Fastify, Tailwind, `npm run dev`)
- [x] 1. Движок + тесты (16 тестов)
- [x] 2. БД + API + сид, журнал и откат
- [x] 3. Frontend-основа (проекты, таблица, редактор задачи)
- [x] 4. Визуализация (статусная полоса, Gantt, граф, таблица, команда)
- [x] 5. What-if: черновик, волна, призраки, панель последствий, журнал + откат
- [x] 6. Советник по срокам + план восстановления
- [x] 7. Демо-скрипт, продакшн-режим `npm start`, Dockerfile (не проверен)

## Допущения, которые могут быть пересмотрены
Даты вычисляются из длительности (мышью на Gantt не тянутся) · нет праздников РФ · «сегодня» сдвигает
незавершённые задачи · нет выравнивания ресурсов · `blocked` — флаг + «не раньше сегодня» ·
пороги (float ≤ 2, ускорение ≤ 30%, нахлёст ≤ 50%) условные · советник эвристический · node:sqlite вместо Prisma ·
без авторизации · срыв промежуточного срока задачи — high-алерт даже при соблюдении дедлайна.
