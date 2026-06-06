# Cofind 2 Web

Статический интерактивный прототип сайта Cofind 2 по ТЗ из документа.

Фронтенд умеет работать в двух режимах:

- API online: читает заявки, чат и тарифы из `http://localhost:4000/api/v1`, поддерживает вход, регистрацию, создание заявок, отправку сообщений, лайки и dev checkout.
- API runtime config online: базовый URL API можно задать через meta-тег `cofind-api-base`, а `localStorage.cofindApiBase` остается пользовательским override.
- Production web build online: `PUBLIC_WEB_URL` и `PUBLIC_API_BASE` на этапе `pnpm --filter @cofind/web build` переписывают `dist/index.html`, `dist/app.js`, `robots.txt` и `sitemap.xml`, чтобы релиз не уехал с localhost в canonical/OG/sitemap/API fallback.
- API readiness online: `GET /health/ready` проверяет, что Postgres и Meilisearch доступны перед smoke/demo.
- API security headers online: smoke проверяет `X-Content-Type-Options` и `X-Frame-Options` на health endpoint.
- API status online: индикатор в шапке использует readiness и показывает частичную деградацию, если база или поиск недоступны.
- Auth validation online: регистрация ловит дубли email/username без учета регистра и показывает понятную ошибку API.
- Auth refresh online: фронт хранит refresh token и автоматически обновляет access token через `/auth/refresh` при 401.
- Realtime auth refresh online: перед подключением к WebSocket фронт пробует обновить access token, если доступен refresh token.
- Search online: фильтры ленты вызывают `/search/listings` и поддерживают тип, рейтинг, жанр, фандом и персонажа; каталоговые фильтры принимают и `slug`, и название, справочники загружаются из `/tags`, `/genres`, `/fandoms`, `/characters`.
- Search sorting online: сортировки ленты `new`, `popular` и `unanswered` передаются в `/search/listings`, поэтому порядок считается на всей выдаче до пагинации.
- Feed pagination online: лента запрашивает `/search/listings?page=&pageSize=`, показывает пагинацию и использует прямые ссылки `/feed?page=N`.
- Public listings pagination online: `/listings?page=&pageSize=` возвращает `hits + pagination`, при этом `/listings` без `page` остается совместимым массивом.
- Feed URL state online: поиск, тип, рейтинг, жанр, фандом, персонаж, сортировка и флаги ленты сохраняются в query string `/feed?...`, поэтому Back/Forward восстанавливает состояние выдачи.
- Feed saved filters online: пользователь может сохранить фильтры ленты в `localStorage`, восстановить их при обычном входе в ленту и сбросить; прямой query URL имеет приоритет.
- Feed filter chips online: активные фильтры видны чипами, каждый можно снять отдельно, а пустая выдача предлагает сбросить фильтры или предложить новый тег.
- Feed loading UX online: лента показывает статус обновления, выставляет `aria-busy` на список и сообщает о fallback при недоступном API поиска.
- Feed SEO online: страницы ленты обновляют canonical и `rel=prev/next` для пагинации.
- Sitemap online: sitemap использует path-based URL и включает базовые страницы пагинации `/feed?page=N`.
- Static SPA fallback online: dev-server и `_redirects` отдают `index.html` для прямых path-based маршрутов вроде `/listing/:id` и `/feed?...`.
- Native link UX online: SPA-переходы не перехватывают Ctrl/Cmd/Shift-клики и ссылки с `target`, поэтому карточки заявок, профили, related-ссылки и пагинацию можно открывать в новой вкладке обычным браузерным способом.
- Web smoke safety online: smoke-проверка падает на дублирующихся `id` в `index.html`, чтобы SPA-якоря и формы не конфликтовали.
- CSS smoke safety online: smoke-проверка падает, если `styles.css` использует необъявленную custom property без fallback.
- Search terms online: Meilisearch-индекс хранит lower-case terms каталога, поэтому slug-фильтры работают независимо от регистра.
- Listing metrics online: API-лента и search-документы возвращают `likes`, `responses`, `reports`, поэтому сортировка по популярным и без ответа не зависит от источника поиска.
- Viewer state online: публичные лента, detail, search и история общего чата при Bearer-токене возвращают `likedByMe`/`reactedByMe`, поэтому активные лайки и emoji восстанавливаются после обновления страницы.
- Listing editor online: форма создания заявки использует каталоги `/tags`, `/genres`, `/fandoms`, `/characters`; выбранные slug'и можно добавлять и удалять, а статус `PUBLISHED` вызывает `/listings/:id/publish`.
- Listing draft online: новая заявка автосохраняется в `localStorage`, восстанавливается при возвращении на `/me/listings/new` и очищается после успешного сохранения.
- Listing preview online: форма новой заявки показывает live-предпросмотр будущей карточки с выбранными тегами, жанрами, фандомами и персонажами.
- Rich editor online: описание заявки, отклик, общий чат и личные сообщения используют полноценный contenteditable WYSIWYG-редактор вместо markdown-вставок в textarea; форматирование видно сразу, поддержаны жирный, курсив, зачеркнутый, списки, цитата, ссылка, undo/redo, очистка и emoji, значение сохраняется как безопасный HTML в скрытом поле, а счетчики считают видимый текст и блокируют слишком тяжелое форматирование до отправки.
- Listing form validation online: форма показывает счетчики заголовка/описания и блокирует отправку вне лимитов API `6-140` и `20-4000`.
- Listing catalog validation online: API отклоняет неизвестные или не approved catalog slug'и с 400 и дедуплицирует повторяющиеся slug'и.
- Listing management online: `/me` показывает заявки автора через `/listings/mine`, позволяет редактировать, открывать свои черновики, публиковать, закрывать и архивировать их; публичный detail скрывает pending/draft-заявки.
- Listing management filters online: блок “Мои заявки” фильтрует заявки по `DRAFT/PUBLISHED/CLOSED/ARCHIVED`, показывает счетчики и пустые состояния.
- Listing management tools online: блок “Мои заявки” поддерживает поиск по названию/тексту/каталогам, счетчик найденного и сортировку по новизне, статусу, откликам или названию.
- Listing detail online: карточка из ленты открывает детальную страницу заявки, догружает полные данные, отправляет отклик, лайк и жалобу по id выбранной заявки.
- Listing links online: карточки заявок в ленте, live-блоке главной и публичном профиле содержат настоящие ссылки `/listing/:id`, а авторы карточек ведут на `/profile/:username`.
- Listing detail UX online: detail показывает live-метрики лайков/откликов/жалоб, блокирует форму отклика для закрытой заявки и даёт шаблон первого сообщения.
- Listing response UX online: форма отклика считает `0 / 4000`, блокирует текст короче 10 символов или длиннее API-лимита и обновляет подсказку до отправки.
- Listing related filters online: ссылки "Все заявки по тегу" и "Фандомы и персонажи" в detail имеют реальные `/feed?...` URL, переводят в ленту с примененным фильтром и сохраняют его в истории браузера без промежуточного `/feed`.
- Listing related cards online: detail заявки показывает похожие заявки по общим тегам, жанрам, фандомам и персонажам с прямым переходом в detail.
- Home live online: главная показывает несколько последних заявок из live-ленты, карточки кликабельны и открывают detail заявки.
- Home recent online: главная показывает локальную историю недавно просмотренных заявок и позволяет очистить её.
- Home chat live online: главная показывает компактное окно с 2-3 последними сообщениями общего чата; карточки сообщений открывают нужную комнату, а рисунки мини-холста отображаются маленьким thumbnail.
- Home catalog cloud online: популярные направления на главной кликабельны и переводят в ленту с выбранным запросом даже до загрузки API-каталога.
- Button safety online: web-runtime нормализует все кнопки без `type` в `type="button"` и следит за динамически отрисованными кнопками, чтобы служебные действия случайно не отправляли формы; `form method="dialog"` оставлен для нативного закрытия модалок.
- Form safety online: web smoke проверяет, что каждая форма с `id` имеет явный submit-handler, а `form method="dialog"` остается нативным для закрытия модалок.
- Chat profile links online: имена авторов в общем чате и live-блоке главной ведут на публичный профиль, когда API отдает username.
- Auth flow online: кнопка входа открывает e-mail авторизацию; из формы входа можно переключиться на регистрацию, а из регистрации вернуться ко входу.
- Auth redirect online: защищенные прямые URL вроде `/me/inbox?conversation=...`, `/me/listings/new` и `/admin` сохраняются перед логином/регистрацией и восстанавливаются после успешной авторизации.
- Auth recovery online: из формы входа можно открыть восстановление пароля, запросить reset token и сохранить новый пароль через API.
- Auth recovery mail online: production reset-ссылка `/auth?resetToken=...&email=...` открывает форму восстановления и подставляет token из письма.
- Auth form UX online: формы входа, регистрации, сброса и смены пароля используют browser/password-manager friendly `autocomplete`.
- Auth validation UX online: регистрация и профиль на фронте повторяют ключевые лимиты API для username, display name и паролей.
- Auth security online: в `/me` доступна смена пароля через текущий пароль.
- Auth guard online: переходы на `/me`, `/me/inbox`, создание заявки и админку без токена открывают e-mail вход и после авторизации возвращают пользователя на запрошенный экран.
- Role-aware cabinet online: личный кабинет показывает быстрые действия и карточки режима по роли аккаунта; USER/PREMIUM не видят админку, MODERATOR видит модерацию, OWNER/ADMIN видят блок запуска и управления платными/SEO/финансовыми разделами.
- Role-aware admin online: внутри админки MODERATOR не видит owner/admin-only панели запуска, reindex, тарифов, финансов, SEO и audit log; OWNER/ADMIN получают эти секции после входа.
- Auth return online: действия гостя вроде отклика, жалобы, Premium checkout, сохранения профиля/внешнего вида и admin-форм запоминают текущий экран и возвращают на него после входа.
- Header account online: после входа кнопка с аватаром в шапке ведет в `/me`, а для гостя остается входом `/auth`.
- Deep links online: SPA fallback распознает `/listing/:id`, `/profile/:username`, `/me/inbox`, `/feed`, `/chat` и после загрузки API открывает целевой экран.
- Browser history online: переходы формируют path-based URL, используют `pushState`, а Back/Forward восстанавливаются через `popstate/hashchange` без затирания истории.
- Responsive layout online: основные экраны оптимизированы для 360-430px, 720px и планшетов; хедер складывается компактнее, таблицы админки скроллятся по горизонтали, чат и превью рисунков ограничены по высоте.
- Navigation accessibility online: активный пункт основной навигации получает визуальное состояние и `aria-current="page"`.
- Keyboard accessibility online: в начале страницы есть skip-link к `main`, чтобы быстро перейти мимо длинного хедера.
- Rich toolbar accessibility online: кнопки WYSIWYG-панелей получают `title` и `aria-label` для компактных действий `B/I/Цитата/Список/Ссылка`.
- Share links online: detail заявки и публичный профиль копируют прямые URL через Clipboard API с fallback.
- Static pages online: `/help`, `/rules`, `/privacy`, `/contacts` работают как публичные SPA-страницы, индексируются и включены в sitemap.
- Notification links online: кнопка "Открыть" в уведомлении использует тот же роутер, поддерживает `/me/subscription` и помечает уведомление прочитанным при переходе.
- Profile online: детальная заявка открывает публичный профиль автора через `/profiles/:username`, включая био, метрики и опубликованные заявки.
- Profile activity online: публичный профиль показывает последнюю активность автора по `lastSeenAt`, а API обновляет ее на защищенных запросах.
- Profile privacy online: в `/me` можно скрыть последнюю активность и запретить новые личные диалоги с публичного профиля; публичный профиль показывает “ЛС закрыты”.
- Profile socials online: в `/me` можно сохранить сайт/портфолио, Telegram и Discord; публичный профиль показывает их компактными ссылками/чипами.
- Avatar online: в ЛК можно выбрать preset-аватар или загрузить изображение до 128KB; `avatarUrl` сохраняется через `/me/profile` и отображается в шапке, ЛК, публичном профиле, inbox, личных сообщениях и общем чате.
- Avatar upload online: при доступном API файл PNG/JPEG/WebP загружается через `/uploads/images`, профиль сохраняет публичный URL вместо большого data URL; локальное превью остается fallback, а тип и лимит 128KB проверяются до чтения файла.
- Image optimization online: avatar, cover, background и mini-canvas drawing перед загрузкой уменьшаются через canvas до целевых размеров и лимитов, динамические изображения получают lazy loading/async decoding, а рекламные и drawing-превью имеют стабильные размеры на мобильных.
- Safe media URLs online: аватары, обложки, фон студии и рекламные картинки/ссылки рендерятся только из безопасных `http(s)` или `data:image` PNG/JPEG/WebP источников; опасные схемы не показываются.
- Safe ad HTML online: рекламный `htmlCode` рендерится через ограниченный безопасный subset HTML, где ссылки и картинки проходят `http(s)`-фильтр.
- Upload API limit online: API поднимает JSON/body limit до 512KB, чтобы base64-обертка не ломала реальные изображения до 256KB; сервисный лимит файла остается 256KB.
- Upload cleanup online: при замене avatar, cover или фонового изображения API удаляет старый локальный файл `/uploads/images/...`; при деактивации чистит avatar/cover/background, при удалении сообщения общего чата чистит файл рисунка мини-холста; внешние URL и data URL не трогает.
- Profile cover online: в ЛК можно вставить URL или загрузить PNG/JPEG/WebP до 256KB как `purpose: "cover"`; `coverImageUrl` сохраняется через `/me/profile` и отображается в ЛК и публичном профиле.
- Drawing upload online: рисунок из мини-холста в общем чате проверяется по лимиту 256KB, загружается через `/uploads/images` с `purpose: "drawing"` и сохраняется в сообщении публичным URL.
- Public availability online: профили и публичные заявки авторов banned/temp-banned/deleted скрываются из detail/search как недоступные.
- Public profile catalog online: заявки в публичном профиле приходят с tags/genres/fandoms/characters.
- Public profile metrics online: заявки в публичном профиле приходят с `likes`, `responses`, `reports`.
- Public profile stats online: `/profiles/:username` отдает агрегаты `stats` по всем опубликованным заявкам автора и `listingsPagination`, а web-карточка автора показывает суммарные лайки и отклики.
- Public profile listing tools online: список заявок автора в `/profile/:username` поддерживает серверный поиск, счетчик, сортировку по новизне/лайкам/откликам и URL-пагинацию `?listingsPage=N`.
- Profile direct message online: с публичного профиля можно открыть личный диалог через `/conversations/direct`; существующий диалог переиспользуется.
- Profile direct privacy online: `/conversations/direct` возвращает 403, если автор запретил новые сообщения из публичного профиля.
- Safety online: из детальной заявки и публичного профиля можно заблокировать автора через `/me/blocks`, а на `/me` доступен блок-лист с поиском, счетчиком и разблокировкой.
- Profile report online: из публичного профиля можно открыть форму жалобы на `PROFILE` с уже заполненным ID автора.
- Block safety online: попытка заблокировать несуществующего пользователя корректно возвращает 404.
- Inbox online: раздел `/me/inbox` показывает диалоги, исходящие и входящие отклики, автор заявки может принять или отклонить новый отклик, открыть историю личного диалога и отправить сообщение.
- Inbox deep links online: открытый личный диалог обновляет URL до `/me/inbox?conversation=<id>`, а прямой заход восстанавливает выбранный разговор после загрузки inbox.
- Inbox filters online: inbox фильтруется по `all/new/sent/dialogs`, состояние хранится в query `tab`, а кнопки браузера восстанавливают выбранный срез.
- Inbox list tools online: список inbox поддерживает поиск по автору, заявке и сообщению, счетчик найденного и сортировку по свежести, непрочитанным, статусу или названию.
- Inbox UX online: `/me/inbox` показывает summary по новым откликам, диалогам и непрочитанным; личный composer считает `0 / 4000` и не отправляет пустые сообщения.
- Private search online: открытый личный диалог поддерживает поиск по автору, email и тексту сообщения, быстрый сброс фильтра и копирование прямой ссылки на разговор.
- Private delete online: в личном диалоге можно удалить свое сообщение через `DELETE /conversations/:id/messages/:messageId`.
- Private history pagination online: личный диалог грузит последние сообщения и умеет дозагружать старые через cursor-кнопку без сброса текущей позиции прокрутки.
- Inbox unread online: список диалогов показывает `unreadCount`, открытие диалога отправляет `/conversations/:id/read`.
- Listing inbox pagination ready: API поддерживает `hits + pagination` для `/listings/mine`, исходящих/входящих откликов и откликов конкретной заявки при `page/pageSize`, сохраняя массив без `page`.
- Messaging safety online: личные диалоги и новые сообщения блокируются, если между участниками есть блокировка.
- Messaging availability online: личные диалоги и новые сообщения блокируются, если участник banned/temp-banned/deleted.
- Messaging validation online: диалог с несуществующим участником возвращает 404.
- Conversation validation online: API чистит и дедуплицирует participantIds, ограничивая размер создаваемого диалога.
- Response safety online: API принимает отклики только на опубликованные approved-заявки и учитывает блокировки пользователей.
- Response availability online: API блокирует отклики на заявки авторов banned/temp-banned/deleted.
- Response status safety online: принятое или отклоненное решение по отклику становится терминальным.
- Listing action validation online: повторный отклик возвращает 400, лайк несуществующей или непубличной заявки возвращает 404.
- Realtime online: подключается к `ws://localhost:4000/ws/chat` и получает новые сообщения общего чата без перезагрузки.
- Realtime safety online: WebSocket-сообщения используют те же проверки пользователя, цитируемых сообщений и рисунков, что и REST chat.
- Chat actions online: свои сообщения общего чата можно удалить через `DELETE /chat/messages/:id`; если у сообщения был локальный рисунок мини-холста, API удаляет файл из `/uploads/images`.
- Chat composer UX online: composer показывает лимит `0 / 4000`, live/API-статус отправки и блокирует пустую отправку без текста или рисунка.
- Chat search online: общий чат фильтрует сообщения по автору, username, роли, тексту и цитате, показывает счетчик найденного и быстрый сброс.
- Chat history online: общий чат дозагружает старые сообщения через cursor, добавляет их сверху и сохраняет позицию просмотра.
- Chat rooms online: комнаты `# общий`, `# поиск соигроков`, `# фандомы`, `# модерация` стали рабочими фильтрами; выбранная комната сохраняется в браузере, восстанавливается из `/chat?room=...`, копируется прямой ссылкой, а API хранит комнату отдельным полем `room`.
- Chat likes online: история общего чата возвращает сохраненные счетчики лайков.
- Like/reaction toggle online: web не раздувает счетчики локально; заявки, chat likes и одна активная emoji-реакция на сообщение ставятся/снимаются через API toggle с актуальным счетчиком из ответа.
- Chat drawings online: мини-холст показывает preview, при API online загружает рисунок в локальное хранилище, отправляет URL через REST, получает сохраненный `drawings[]` и показывает его в ленте чата; обычный текст продолжает идти через WebSocket.
- Drawing preview online: перед отправкой рисунок показывается маленьким preview в composer, проверяется по лимиту 256KB и может быть снят.
- Drawing-only API online: общий чат принимает `drawingUrl` без отдельного текста и подставляет безопасную подпись, поэтому рисунок можно отправить как самостоятельное сообщение.
- Chat safety online: удаленные сообщения общего чата нельзя лайкать, реакциировать или цитировать.
- Appearance online: после входа мастерская внешнего вида загружает и сохраняет настройки через `/me/preferences`.
- Background online: мастерская внешнего вида сохраняет и убирает URL фонового изображения через `/me/background`, умеет загружать файл PNG/JPEG/WebP до 256KB через `/uploads/images` с `purpose: "background"`; неверный тип или размер отсекается до preview/upload, а удаление фона чистит старый локальный файл.
- Studio online: `/me` показывает данные текущего профиля, количество заявок, отклики, Premium-статус и уведомления; уведомления можно отмечать прочитанными.
- Studio readiness online: `/me` показывает чеклист готовности профиля с аватаром, обложкой, био, творческими метками, контактами и быстрыми переходами к профилю, созданию заявки и inbox.
- Studio profile share online: из `/me` можно открыть собственный публичный профиль и скопировать ссылку `/profile/:username`.
- Data export online: из блока безопасности `/me` можно скачать JSON через `/me/export`; экспорт включает пользовательский контент и не содержит password hash.
- Account deactivation online: из блока безопасности `/me` можно деактивировать аккаунт после ввода пароля; web очищает сессию, а API скрывает профиль и заявки через статус `DELETED`.
- Account restore admin online: в таблице пользователей админки для `DELETED` показывается Restore, действие возвращает `ACTIVE` и записывает audit metadata с предыдущим статусом.
- Liked listings online: `/me` показывает понравившиеся публичные заявки через `/me/liked-listings`, поддерживает поиск/сортировку избранного, а повторный лайк убирает заявку из списка.
- Notification/block edge cases online: missing notification read возвращает 404, повторный unblock безопасно возвращает `unblocked: false`.
- Notification UX online: кнопки уведомлений получают контекстные подписи вроде "Открыть диалоги" или "Открыть подписку", а пустой список ведет в inbox.
- Notification filters online: уведомления в `/me` фильтруются по всем, непрочитанным и прочитанным, а “Прочитать все” отключается без новых уведомлений.
- Account history pagination ready: API поддерживает `hits + pagination` для `/notifications`, `/me/payments`, `/me/liked-listings`, `/suggestions/my` и `/reports/my` при `page/pageSize`, сохраняя массив без `page`.
- Header notifications online: после входа в шапке появляется быстрый переход в inbox с бейджем непрочитанных уведомлений и личных сообщений.
- Profile edit online: `/me` сохраняет имя, био, стиль письма, темп, любимые жанры, фандомы и персонажей через `PATCH /me/profile`.
- Profile preferences online: `/me` сохраняет грамотность, ожидаемую длину поста и формат связи, а публичный профиль показывает их в творческих метках.
- Public profile format online: публичный профиль показывает стиль, грамотность, длину поста, темп и связь отдельным компактным блоком.
- Profile cover edit online: `/me` сохраняет `coverImageUrl`, показывает preview перед сохранением и применяет обложку на собственной и публичной карточке профиля.
- Listing delete online: в `/me` владелец может мягко удалить заявку через `/listings/:id/delete`; она исчезает из ЛК и публичных списков, связи для истории не ломаются.
- Listing restore admin online: в очереди админки скрытые/удаленные заявки получают Restore, который возвращает `DRAFT/PENDING`, а не публикует контент сразу.
- Subscription online: `/me/subscription` показывает текущий Free/Premium-статус, план и дату окончания после входа.
- Monetization launch switch online: публичные Premium-кнопки, тарифы, checkout и платежная история скрыты, пока `features.monetizationEnabled=false`; OWNER/ADMIN включает показ в админке через переключатель “Публичные функции”.
- Subscription cancel online: `/me/subscription` умеет отключать Premium через `/me/subscription/cancel`; UI сразу обновляет статус и историю.
- Payments online: `/me/subscription` показывает историю платежей через `/me/payments` с поиском, фильтром статуса и счетчиком.
- Payment safety online: финальный платеж терминален; повторные или поздние конфликтующие webhook-и не продлевают, не откатывают и не активируют подписку после failed/canceled/refunded, а Premium-флаг не перетирает роль аккаунта.
- Checkout validation online: `planCode` нормализуется по регистру/пробелам, webhook не принимает пустые id.
- Ads online: рекламные слоты на главной и в ленте загружают `/ads/placements` и скрываются для Premium при `hideForPremium`.
- Ads limit online: публичная выдача рекламы скрывает placement'ы с исчерпанным `impressionLimit`.
- Ads schedule validation online: admin API принимает даты показа и отклоняет неверный порядок `startsAt/endsAt`.
- SEO online: `<title>`, description, canonical, `og:url` и `og:image` текущего экрана обновляются через `/seo/page` с локальным fallback.
- Dynamic SEO online: страницы `/listing/:id` и `/profile/:username` получают title/description/canonical из текущей заявки или профиля, если отдельная SEO-страница не заведена в админке.
- Structured data online: SPA добавляет JSON-LD для главной (`WebSite`), ленты (`ItemList`), заявки (`CreativeWork`) и профиля (`Person`).
- Profile structured data online: JSON-LD профиля включает `sameAs` из сайта/Telegram, интересы автора и `InteractionCounter` по лайкам/откликам.
- Profile media cleanup online: очистка аватара/обложки отправляет `null`, а API удаляет прежний локальный `/uploads/images/...` файл.
- Deactivation media cleanup online: при деактивации API удаляет локальные upload-файлы профиля, фона и мини-холста, а также строки `CanvasDrawing` пользователя.
- Static SEO baseline online: `index.html` уже содержит базовые `robots`, canonical и `og:url`, а SPA обновляет их при переходах.
- Release SEO guard online: корневой `pnpm release:check` проверяет production `dist` на HTTPS-домены, совпадение `cofind-api-base`, sitemap/robots и отсутствие приватных URL.
- Admin tabs online: админка разделена на вкладки `/admin?tab=...`; owner/admin видят запуск, Premium, SEO и audit отдельно, а тяжелые списки грузятся при открытии нужного раздела.
- CSP baseline online: `index.html` и dev-server задают базовую Content Security Policy для скриптов, форм, изображений и API/WS-соединений.
- SEO robots online: публичные экраны получают `index,follow`, а ЛК, inbox, создание заявки, жалобы, auth и admin - `noindex,nofollow`.
- Chat reaction guard online: frontend блокирует параллельные клики реакций на одном сообщении, backend хранит только одну активную emoji-реакцию пользователя.
- Admin online: для OWNER/ADMIN/MODERATOR страница админки загружает dashboard, жалобы, предложения и заявки из `/admin/*`; очередь модерации поддерживает поиск, фильтр типа, фильтр статуса и счетчик.
- Admin actions online: staff-роли могут закрывать/отклонять жалобы, одобрять/отклонять предложения и одобрять/скрывать заявки прямо из таблицы модерации.
- Moderation notifications online: изменения статуса жалоб, предложений и заявок создают уведомления для авторов.
- Audit online: OWNER/ADMIN видят последние записи `/admin/audit-log` с поиском, фильтром типа объекта и счетчиком; модерация и admin upsert-операции каталога, персонажей, рекламы, тарифов и SEO пишут audit-события.
- Catalog admin online: staff-роли могут просматривать и редактировать теги через `/admin/tags`; список поддерживает поиск, фильтр статуса и счетчик.
- Genre admin online: staff-роли могут просматривать и редактировать жанры через `/admin/genres`; список поддерживает поиск, фильтр статуса и счетчик.
- Fandom admin online: staff-роли могут просматривать и редактировать фандомы и персонажей через `/admin/fandoms` и `/admin/characters`; списки поддерживают поиск, фильтр статуса и счетчик.
- Catalog admin validation online: конфликты уникальных имен тегов, жанров и фандомов возвращают понятный 400.
- Admin slug validation online: некорректные slug'и каталога и code Premium-тарифов из PATCH-пути возвращают 400.
- Admin form validation online: web-админка повторяет ключевые ограничения admin API для slug/code справочников и тарифов: 2-80 символов, lowercase, цифры и дефис.
- Character admin validation online: отсутствующий `fandomId` при сохранении персонажа возвращает 404.
- Users admin online: staff-роли видят пользователей с поиском, фильтром роли, фильтром статуса и счетчиком, могут temp-ban/unban/restore, а OWNER/ADMIN могут переключать USER/MODERATOR.
- Users activity admin online: таблица пользователей показывает последнюю активность рядом со статусом.
- Admin hierarchy online: UI и API скрывают/запрещают действия над пользователями равного или более высокого уровня роли.
- Admin safety online: API запрещает self-role/self-ban действия и демоут или отключение последнего OWNER.
- Admin not-found safety online: отсутствующие пользователи, заявки, жалобы, предложения и рекламные placement'ы возвращают 404.
- Ban safety online: истекший temp-ban автоматически снимается при следующем логине или защищенном запросе.
- Mute safety online: muted-пользователь может читать сайт, но не может отправлять chat/private messages и отклики.
- Roles/Premium safety online: изменение роли в админке не сбрасывает активный Premium.
- Plan admin online: OWNER/ADMIN могут просматривать и редактировать Premium-тарифы через `/admin/subscription-plans`; список поддерживает поиск, фильтр активности и счетчик.
- Ads admin online: staff-роли могут создавать и редактировать рекламные placement'ы через `/admin/ads`; `PATCH /admin/ads/new` создает новый placement, список поддерживает поиск, фильтры позиции/статуса и счетчик.
- Ads admin schedule online: форма рекламы поддерживает `impressionLimit`, `startsAt` и `endsAt`.
- Ads premium targeting online: форма рекламы управляет `hideForPremium`, а публичные слоты скрывают такие placement'ы для Premium.
- Finance admin online: OWNER/ADMIN видят последние платежи и подписки через `/admin/payments` и `/admin/subscriptions`; web-блок поддерживает поиск, фильтр типа, фильтр статуса и счетчик.
- SEO admin online: OWNER/ADMIN могут просматривать и редактировать SEO-страницы через `/admin/seo-pages`; список поддерживает поиск, фильтр индексации и счетчик.
- Search admin online: OWNER/ADMIN могут запускать `/search/reindex` из админки.
- Search reindex safety online: reindex полностью пересобирает Meilisearch и дожидается task-ов, чтобы скрытые/закрытые заявки и заявки недоступных авторов не оставались в поиске.
- Search freshness online: ответы Meilisearch сверяются с Postgres, поэтому только что опубликованные/одобренные заявки доступны в фильтрах без ручного reindex, а устаревшие документы не пробиваются в выдачу.
- Moderation online: формы предложений и жалоб отправляют данные в `/suggestions` и `/reports`, после чего обновляют админскую очередь.
- Moderation form UX online: формы предложений и жалоб показывают счетчики, проверяют URL источника и блокируют отправку вне лимитов API.
- Suggestion validation online: API отклоняет активные дубли предложений одного автора по type/title.
- Suggestions online: страница предложений показывает историю текущего пользователя через `/suggestions/my` с поиском, фильтром статуса и счетчиком.
- Report shortcuts: жалоба из заявки, общего чата и личного диалога открывает форму `/reports/new` с уже заполненным типом объекта и id.
- Reports online: страница жалобы показывает историю текущего пользователя через `/reports/my` с поиском, фильтром статуса и счетчиком.
- Report deep-link online: `/reports/new?entityType=PROFILE&entityId=...` предзаполняет форму, а пустая форма стартует без demo-id.
- Report validation online: API отклоняет жалобы на несуществующие объекты, удаленные сообщения и дубли активных жалоб.
- Mock fallback: если API недоступен, использует встроенные демо-данные и остается полностью открываемым как статический прототип.
- Input normalization online: API обрезает ведущие/замыкающие пробелы в пользовательских строках, чтобы формы и прямые API-запросы вели себя одинаково.
- Profile validation online: API не сохраняет пустое displayName и дедуплицирует списки любимых жанров, фандомов и персонажей.

## Команды

```bash
pnpm --filter @cofind/web dev
pnpm --filter @cofind/web build
pnpm --filter @cofind/web smoke
```

После сборки файлы лежат в `apps/web/dist`.

Production-сборка:

```powershell
pnpm secrets:generate
$env:PUBLIC_WEB_URL="https://cofind.example.com"
$env:PUBLIC_API_BASE="https://api.cofind.example.com/api/v1"
$env:PUBLIC_API_URL="https://api.cofind.example.com/api/v1"
pnpm --filter @cofind/web build
```
